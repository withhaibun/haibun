/**
 * A call's dispatch: authorization, the beforeStep and afterStep cycles, the call's lifecycle events as moves of the
 * actuality machine, its record, its facts and its result. Every surface proves a step through `proveStep`, and the logic
 * engine's prover dispatches each call and each node of the proof here.
 */
import type { AStepper, TStepperStep, TFeatureStep, TBeforeStep, TAfterStep, TAfterStepResult } from "../../steps/domains/stepper.js";
import type { TWorld } from "../domains/world.js";
import type { TActionResult, TStepResult, TSeqPath } from "../../domains/protocol.js";
import { TRACE_SEQ_PATH, Timer, FEATURE_START, SCENARIO_START, SUBSTEP_LEVEL, STATUS, RECORDED_STATUS, LOGIC_STEPPER, verdictOf, type TStepEnd } from "../../domains/protocol.js";
import { streamContext } from "../../transport/domains/step-stream-context.js";
import { actionNotOK } from "../../domains/util.js";
import { normalizeDomainKey } from "../../domains/domains.js";
import { assertFact } from "../../records/pipelines/facts.js";
import { doStepperCycle } from "../../steps/pipelines/stepper-cycles.js";
import { actingAs, askedIn, callerHolds, readScope, runInStep, runInvoking, runReadingAsHeld, runStatedAt, stepInFlight, writtenLevel } from "../../domains/capability-context.js";
import { capabilityAllows } from "../../domains/actions.js";
import { SEQ_PATH_LABEL } from "../../domains/resources.js";
import { SEQ_PATH_ACCESS, executionOf, type TRecordName } from "../domains/seq-path.js";
import { runRegistry, type StepRegistry } from "../../steps/pipelines/step-registry.js";
import { stepMethodName, hostScopedMethodName } from "../../steps/domains/step-method.js";
import { authorizeToolCapability } from "../../steps/pipelines/gate.js";
import { augmentViewHypermedia, isViewOnlyDomain } from "../../steps/derivations/step-hypermedia.js";
import { RESULTS_READ_IN_FULL, afterStepOutcome, foldStep, retainedProducts, stepResultOf } from "../derivations/step-results.js";
import type { TProver } from "../ports.js";
import {
	asRecorded,
	endRecord,
	resultText,
	startRecord,
	viewShown,
	type TStepAuthorization,
	type TStepCall,
	type TStepEnded,
	type TStepRan,
	type TStepRecord,
} from "../derivations/step-records.js";
import { stepEndEvent, stepStartEvent } from "../derivations/lifecycle-events.js";
import { moveActuality } from "./move-actuality.js";

/** How a step is proved and its calls dispatched. `grantedCapability` is the action the call invoked. `held` is what its caller holds, and it
 *  bounds what the step reads. A holder in this process invokes from what it holds, so it passes one list for both.
 *  `delegation` is the delegation the call was made under, and `attributedTo` the agent the call is attributed to, such as
 *  the model whose turn made it, where the caller states them. The step's record states both. */
export type DispatchContext = {
	registry: StepRegistry;
	world: TWorld;
	steppers: AStepper[];
	grantedCapability?: string | string[];
	held?: string | string[];
	delegation?: string;
	attributedTo?: string;
};

/** The actions a capability names: one, several, or an empty list where the call doesn't state a capability. */
const actionsOf = (capability: string | string[] | undefined): string[] => (capability === undefined ? [] : [capability].flat());

/** The actions a caller held, as a step's record states them, where it held any. */
const heldAs = (held: string[]): { held?: string } => (held.length === 0 ? {} : { held: held.join(", ") });

/** The view a step's end states it showed, where it showed one. */
const shown = (showed: string | undefined): { showed?: string } => (showed === undefined ? {} : { showed });

/** The time of a record, as an ISO time from actuality's clock. */
const recordTime = (world: TWorld): string => new Date(world.clock.now()).toISOString();

/**
 * Returns the next path under a parent step.
 *
 * nextSeqPath allocates the path from a count held per parent. A search of a feature's results would read every result on
 * every step. Actuality can service requests for weeks, so the number of results grows for weeks. nextSeqPath returns in
 * constant time. world.runtime.seqPaths holds one entry for each parent.
 *
 * The count only advances, so a path is never allocated twice. An allocation that a step doesn't use leaves a gap in the
 * numbering. Readers read the numbering only for order and identity. A gap preserves both.
 */
export function nextSeqPath(world: TWorld, parent: TSeqPath): TSeqPath {
	const held = world.runtime.seqPaths;
	const key = parent.join(".");
	const taken = held.get(key);
	const index = taken === undefined ? 1 : taken + 1;
	held.set(key, index);
	return [...parent, index];
}

/** The dispatch context of a stepper's own call: actuality's registry, its world and its steppers, under the caller's capability. */
export const stepperContext = (world: TWorld, steppers: AStepper[]): DispatchContext => ({ registry: runRegistry(world), world, steppers });

/** Proves the statements a step states, in order, as one proof of the logic engine under the step's record. */
export const proveStatements = (ctx: DispatchContext, parent: TFeatureStep, statements: TFeatureStep[], targetHostId?: number): Promise<TActionResult> =>
	proverOf(ctx.world).proveStatements(ctx, parent, statements, targetHostId);

/**
 * The authority a call runs under. A capability the dispatch context states takes precedence over callerHolds(). A step
 * dispatched from inside another step invokes from what the caller holds, under the chain the caller presented. Its action is
 * the one in that chain that allows it. The route that dispatched the step doesn't change whether it is refused, and a step
 * doesn't run beyond what that chain holds. A statement that narrows authority sets what its own statements hold in the same
 * way. `holding only` is one such statement.
 */
function authorityOf(ctx: DispatchContext): { grantedCapability: string | string[] | undefined; held: string | string[] | undefined } {
	const grantedCapability = ctx.grantedCapability ?? callerHolds();
	return { grantedCapability, held: ctx.held ?? grantedCapability };
}

/**
 * Runs `run` as a dispatched step's own work runs: under the authority of its call, with the read scope in force as the
 * statement's scope, and at the broadest read its caller holds. A caller that doesn't hold a read action is refused each read
 * and write of records, so a step doesn't read a record for a caller who couldn't read that record. The logic engine's prover
 * reads a quantifier's members, a waypoint's arguments and a node's arguments through it.
 */
export function runAsDispatched<T>(ctx: DispatchContext, run: () => Promise<T>): Promise<T> {
	const { grantedCapability, held } = authorityOf(ctx);
	return runInvoking({ invoked: grantedCapability, held }, () => runStatedAt(readScope(), () => runReadingAsHeld(held, run)));
}

/** What a node of a proof performs in place of a step's action: the proof of its statements, which its caller resolves. */
export type TPerform = () => Promise<TActionResult>;

/** Returns the prover that a stepper of the configuration supplies. Throws where a stepper doesn't supply one, since every line is proved by
 *  the logic engine. */
export function proverOf(world: TWorld): TProver {
	const prover = world.runtime.prover;
	if (prover === undefined) throw new Error(`every step is proved by the logic engine, and a stepper doesn't supply it. List ${LOGIC_STEPPER} in the configuration's steppers.`);
	return prover;
}

/** Proves a step: a feature's line, a statement a step states, or a call a transport carries. Every surface calls it. */
export const proveStep = (ctx: DispatchContext, featureStep: TFeatureStep): Promise<TStepResult> => proverOf(ctx.world).prove(ctx, featureStep);

/**
 * Dispatches one call of a proof. It applies capability authorization, the beforeStep and afterStep cycles, event logging
 * and result tracking. A built-in's call performs the step's action. A node of a proof, such as a negation or a waypoint,
 * performs `perform`, whose result is the node's verdict.
 */
export async function dispatchStep(ctx: DispatchContext, featureStep: TFeatureStep, perform?: TPerform): Promise<TStepResult> {
	const { registry, world, steppers } = ctx;
	const { grantedCapability, held } = authorityOf(ctx);
	const { action } = featureStep;
	const start = Timer.since();

	// A read made into a running instance returns its result without a record. Reading actuality isn't an act of
	// actuality. A page that follows actuality sends a read on every announcement. Each such read recorded as a step would
	// write a record, announce it to every page and keep a result in this process for as long as the process runs.
	//
	// Every transport marks the steps it carries programmatic. A read that a feature states in its own body is a step of
	// actuality, whether the line reads directly or a combinator runs the read beneath it. In `set x from <a read>` the
	// feature reads, and the read's result is the step's result. The rule tests `programmatic` and not `isSubStep`, because
	// a read beneath a combinator is also a substep, and actuality records it. A read a transport carries within a step, such
	// as a model's tool call during a turn, is that step's act, so actuality records it too.
	const recorded = !(action.step.read === true && featureStep.programmatic === true && stepInFlight() === undefined);
	// Actuality holds two records of the steps a feature has finished. `world.runtime.steps` holds how many ran, when they
	// began and ended, and which one failed. foldStep updates it as each step settles. `world.runtime.stepResults` holds
	// the most recent RESULTS_READ_IN_FULL results in full, since a reader of the result reads what those steps produced.
	// An older step doesn't have a reader. The limit prevents actuality from holding every graph slice, response body and
	// rendered document it has produced. The limit also bounds the steps held for a feature that services requests for weeks.
	// `place` adds a step's result when the handler returns, so the step precedes the steps its cycles run. `settle` counts
	// the outcome the cycles determine and writes it in the same position.
	const place = (result: TStepResult): void => {
		if (!recorded) return;
		const held = world.runtime.stepResults;
		held.push(result);
		if (held.length > RESULTS_READ_IN_FULL) held.shift();
	};
	const settle = (placed: TStepResult, result: TStepResult): void => {
		if (!recorded) return;
		foldStep(world.runtime.steps, result);
		const held = world.runtime.stepResults;
		const at = held.indexOf(placed);
		if (at >= 0) held[at] = result;
	};
	const keep = (result: TStepResult): void => {
		place(result);
		settle(result, result);
	};
	const pushAndReturn = (result: TStepResult): TStepResult => {
		keep(result);
		return result;
	};

	const bareMethod = stepMethodName(action.stepperName, action.actionName);
	const method = featureStep.targetHostId !== undefined ? hostScopedMethodName(featureStep.targetHostId, bareMethod) : bareMethod;
	const tool = registry.get(method);
	if (!tool) {
		// The refusal for a step the registry doesn't hold includes the step's description, as the refusal for an unresolved
		// line states its reason.
		const described = action.step.description ? `: ${action.step.description}` : "";
		return pushAndReturn(stepResultOf(actionNotOK(`The registry doesn't hold ${method}${described}. Load its stepper.`), action, start, Timer.since(), featureStep));
	}

	// The read scope in force where the statement was stated. Its arguments are read in this scope, and
	// authorizeToolCapability refuses a step that reads above its ceiling.
	const statedAt = readScope();
	const refusal = refusalOf(() =>
		authorizeToolCapability(tool.descriptor, { invoked: grantedCapability, held }, statedAt !== undefined && "ceiling" in statedAt ? statedAt.ceiling : undefined),
	);
	// A feature's or a scenario's start is recorded without the step's cycles, after its caller's capability is checked.
	if (action.actionName === FEATURE_START || action.actionName === SCENARIO_START) {
		if (refusal !== undefined) throw refusal;
		const started = await writeStepStart(world, featureStep, {}, { ranVia: "local" }, callOf(ctx));
		await writeStepEnd(world, started, { status: RECORDED_STATUS.completed });
		return stepResultOf({ ok: true }, action, start, Timer.since(), featureStep);
	}
	// The authorization the step's own record states. The record states the invoked action that allows the step and the
	// actions the caller held, where the caller isn't actuality acting as itself. It states the principal that proved its
	// identity, where one did, and the delegation the call was made under, where the caller states one.
	const authorization: TStepAuthorization = {
		...(!capabilityAllows(grantedCapability, "*")
			? { invoked: actionsOf(grantedCapability).find((action) => capabilityAllows(action, tool.descriptor.capability)), ...heldAs(actionsOf(held)) }
			: {}),
		controller: actingAs(),
		...(ctx.delegation === undefined ? {} : { delegation: ctx.delegation }),
	};
	// The step as its records state it. A domain's `recordedAs` replaces a value too large to repeat in the records.
	const stated = asRecorded(featureStep, world.domains);
	const called = { stepperName: action.stepperName, actionName: action.actionName, stepValuesMap: stated.action.stepValuesMap };
	let started: TStepRecord | undefined;
	if (recorded) {
		await moveActuality(world, stepStartEvent(stated, called, tool.isAsync, world.clock.now()));
		started = await writeStepStart(world, stated, authorization, { ranVia: tool.transport, ranOn: tool.descriptor.remoteOrigin }, callOf(ctx));
	}
	// A refused call ends as failed with the refusal, so its record states why it didn't run, and the refusal reaches the caller.
	if (refusal !== undefined) {
		if (started) {
			await moveActuality(world, stepEndEvent(stated, called, { status: STATUS.failed, error: refusal.message, products: undefined }, world.clock.now()));
			await writeStepEnd(world, started, { status: RECORDED_STATUS.failed, error: refusal.message });
		}
		throw refusal;
	}
	// A log written while a substep runs doesn't report above the substep's level, except a warning or an error. The web
	// server marks an RPC call into a running instance as a substep, so the caller's narration doesn't appear among
	// actuality's steps.
	const step = { seqPath: featureStep.seqPath.join("."), reportsAt: featureStep.isSubStep ? SUBSTEP_LEVEL : undefined };
	let actionResult: TActionResult | undefined;
	let lastStepResult: TStepResult | undefined;
	await runInStep(step, () =>
		runAsDispatched(ctx, async () => {
			let doAction = true;
			while (doAction) {
				await doStepperCycle(steppers, "beforeStep", <TBeforeStep>{ featureStep });
				// The handler validates the step's products against the step's domain. A tool of another host or process
				// validates them where it runs.
				actionResult = await (perform === undefined ? tool.handler(featureStep, world) : perform());
				if (actionResult.ok) {
					if (actionResult.products) actionResult = { ...actionResult, products: { ...actionResult.products, [TRACE_SEQ_PATH]: featureStep.seqPath } };
					actionResult = augmentViewHypermedia(world, action.step, actionResult, steppers);
					// A fact is a record of actuality. Actuality doesn't record a read over a transport as a step or assert its products.
					if (recorded) await autoAssertProducts(world, { execution: executionOf(world.tag), path: featureStep.seqPath }, action.step, actionResult);
				}
				// A nested call's failure is part of its line's proof, so only a line's failure is logged as an error.
				if (!actionResult.ok && featureStep.isSubStep !== true) {
					world.eventLogger.log(featureStep, "error", actionResult.errorMessage);
				}
				const placed = stepResultOf(actionResult, action, start, Timer.since(), stated);
				place(placed);
				const instructions: Array<TAfterStepResult | undefined> = await doStepperCycle(steppers, "afterStep", <TAfterStep>{ featureStep, actionResult });
				doAction = instructions.some((i) => i?.rerunStep);
				// An afterStep cycle can fail a step that passed, so actuality counts the outcome afterStepOutcome computes.
				actionResult = afterStepOutcome(actionResult, instructions);
				lastStepResult = stepResultOf(actionResult, action, start, placed.end ?? Timer.since(), stated);
				settle(placed, lastStepResult);
			}
		}),
	);
	if (!actionResult || !lastStepResult) {
		throw new Error(`${action.stepperName}.${action.actionName} didn't record an action result`);
	}
	const ok = actionResult.ok;
	if (!recorded) return lastStepResult;
	// A step that doesn't pass while its caller's stream is aborted ends as stopped. The caller stopped it, so the step didn't fail.
	const ended: TStepEnd = ok ? STATUS.completed : streamContext.getStore()?.signal.aborted ? STATUS.stopped : STATUS.failed;
	if (!started) throw new Error(`${action.stepperName}.${action.actionName} ended without the record its start writes`);
	const error = actionResult.ok ? undefined : actionResult.errorMessage;
	await moveActuality(
		world,
		stepEndEvent(stated, called, { status: ended, error, products: retainedProducts(actionResult.products, action.step.retainProducts) }, world.clock.now()),
	);
	// A call a transport carries states what it read back, since its caller reads the result and not a line.
	const result = featureStep.programmatic === true && actionResult.products !== undefined ? { result: resultText(actionResult.products) } : {};
	const verdict = verdictOf(actionResult);
	await writeStepEnd(world, started, { status: RECORDED_STATUS[ended], verdict, ...(error === undefined ? {} : { error }), ...shown(viewShown(actionResult.products)), ...result });
	return lastStepResult;
}

/** Returns the error `authorize` throws, or undefined where it doesn't throw. Throws what isn't an Error, since a refusal is one. */
function refusalOf(authorize: () => void): Error | undefined {
	try {
		authorize();
		return undefined;
	} catch (err) {
		if (err instanceof Error) return err;
		throw err;
	}
}

/** Returns the call a step's record states: the level at which the call writes a SeqPath record, which is its read level, the
 *  ask that holds the call, and the agent that the dispatch context names. */
function callOf(ctx: DispatchContext): TStepCall {
	const asked = askedIn();
	return {
		accessLevel: writtenLevel(SEQ_PATH_ACCESS),
		...(asked === undefined ? {} : { askedIn: asked }),
		...(ctx.attributedTo === undefined ? {} : { attributedTo: ctx.attributedTo }),
	};
}

/**
 * Writes a fact of a step's retained products under the step's declared products domain or domains. The fact's id is the
 * step's record name, so a step that runs again replaces its fact rather than adding a second one.
 *
 * The products of a view-only domain aren't asserted. The `shu-monitor-column` products of `show monitor` are one example.
 * `isViewOnlyDomain` states why.
 */
async function autoAssertProducts(world: TWorld, stepName: TRecordName, step: TStepperStep, actionResult: TActionResult): Promise<void> {
	// Actuality holds a fact for as long as it runs, so the fact holds only what the step retains, as the step's end event does.
	const products = retainedProducts(actionResult.products, step.retainProducts);
	if (!products) return;
	const store = world.shared.getStore();
	const generatedAtTime = recordTime(world);
	if (step.productsDomain) {
		if (isViewOnlyDomain(world, step.productsDomain)) return;
		await assertFact(store, stepName, { domain: normalizeDomainKey(step.productsDomain), value: products, generatedAtTime });
		return;
	}
	if (step.productsDomains) {
		for (const [field, domainKey] of Object.entries(step.productsDomains)) {
			if (!(field in products)) continue;
			if (isViewOnlyDomain(world, domainKey)) continue;
			await assertFact(store, stepName, { domain: normalizeDomainKey(domainKey), value: products[field], field, generatedAtTime });
		}
	}
}

/**
 * Writes a step's record when the step starts, so an individual created during the step can link to it by a graph edge.
 * One upsert writes every required field: sequential writes would let a concurrent reader read a step without its
 * generatedAtTime, which fails the SeqPath schema. getClusteredQuads on a polling tick is one such reader. Returns the
 * record, which the step's end writes again with how it ended.
 */
async function writeStepStart(world: TWorld, featureStep: TFeatureStep, authorization: TStepAuthorization, ran: TStepRan, call: TStepCall): Promise<TStepRecord> {
	const record = startRecord(executionOf(world.tag), featureStep, authorization, ran, call, recordTime(world));
	await world.shared.getStore().upsertIndividual(SEQ_PATH_LABEL, record);
	return record;
}

/** Writes a step's record when the step ends: its start with how it ended, in one upsert. */
async function writeStepEnd(world: TWorld, start: TStepRecord, ended: TStepEnded): Promise<void> {
	await world.shared.getStore().upsertIndividual(SEQ_PATH_LABEL, endRecord(start, ended, recordTime(world)));
}
