/**
 * A call's dispatch: authorization, the beforeStep and afterStep cycles, the call's lifecycle events as moves of the
 * actuality machine, its record, its facts and its result. Every surface proves a step through `proveStep`, and the logic
 * engine's prover dispatches each call and each node of the proof here.
 */
import type { AStepper, TStepperStep, TFeatureStep, TBeforeStep, TAfterStep, TAfterStepResult } from "../../steps/domains/stepper.js";
import { proverOf, type TWorld } from "../domains/world.js";
import { recordTime } from "../domains/record-time.js";
import type { TActionResult, TStepResult, TSeqPath } from "../../domains/protocol.js";
import { TRACE_SEQ_PATH, Timer, FEATURE_START, SCENARIO_START, SUBSTEP_LEVEL, STATUS, RECORDED_STATUS, verdictOf, VERDICT, type TStepEnd } from "../../domains/protocol.js";
import { streamContext } from "../../transport/domains/step-stream-context.js";
import { actionNotOK } from "../../domains/util.js";
import { isRead } from "../../domains/actions.js";
import { normalizeDomainKey } from "../../domains/domains.js";
import { assertFact } from "../../records/pipelines/facts.js";
import { entailmentRecorded } from "../../records/derivations/claim.js";
import { doStepperCycle } from "../../steps/pipelines/stepper-cycles.js";
import { runAsWork } from "../../domains/event-loop.js";
import { inCall, isNested, nestedOf, runInCall, writtenLevel, type TCallContext } from "../../domains/capability-context.js";
import { heldAuthority } from "../../domains/session-authority.js";
import { authorityRefusal, RefusedCall } from "../../transport/domains/rpc-wire.js";
import { SEQ_PATH_LABEL } from "../../domains/resources.js";
import { SEQ_PATH_ACCESS, actualityFeatureOf, type TRecordName } from "../domains/seq-path.js";
import { listedStatement, runRegistry, type StepRegistry } from "../../steps/pipelines/step-registry.js";
import type { TList } from "../../domains/lists.js";
import { stepMethodName, hostScopedMethodName } from "../../steps/domains/step-method.js";
import { authorizeToolCapability } from "../../steps/pipelines/gate.js";
import { augmentViewHypermedia, isViewOnlyDomain, productsRetained } from "../../steps/derivations/step-hypermedia.js";
import { RESULTS_READ_IN_FULL, afterStepOutcome, foldStep, retainedProducts, stepResultOf } from "../derivations/step-results.js";
import {
	asRecorded,
	authorizationOf,
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
import { contractProducts, stepWrites } from "../../steps/domains/contract.js";

/** Where a step is proved and its calls dispatched: actuality's registry, its world and its steppers. The record of the call
 *  in progress (`inCall`) holds the call's authority, so a dispatch context doesn't hold it. */
export type DispatchContext = { registry: StepRegistry; world: TWorld; steppers: AStepper[] };

/** The view a step's end states it showed, where it showed one. */
const shown = (showed: string | undefined): { showed?: string } => (showed === undefined ? {} : { showed });

/**
 * Returns the next path under a parent step.
 *
 * nextSeqPath allocates the path from a count held per parent. A search of a feature's results would read every result on
 * every step. Actuality can service requests for weeks, so the number of results grows for weeks. nextSeqPath returns in
 * constant time. world.runtime.seqPaths holds one entry for each parent, and a call's entries go once it ends
 * (`releaseSeqPaths`).
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

/**
 * Releases the counts of the paths under `root`, the seqPath of a call that ended. A call doesn't allocate a path under
 * its seqPath after it ends, and the counts otherwise hold one entry for each parent of every call for as long as
 * actuality runs, so the counts hold the parents of the calls in progress and of the features' own steps.
 */
export function releaseSeqPaths(world: TWorld, root: TSeqPath): void {
	const key = root.join(".");
	for (const held of world.runtime.seqPaths.keys()) if (held === key || held.startsWith(`${key}.`)) world.runtime.seqPaths.delete(held);
}

/**
 * Proves a call's step at the path this host allocated for it. The count under the path starts when the call starts, and
 * the counts under the path are released once the call ends.
 */
export async function proveClaimed(ctx: DispatchContext, featureStep: TFeatureStep): Promise<TStepResult> {
	ctx.world.runtime.seqPaths.set(featureStep.seqPath.join("."), 0);
	try {
		return await proveStep(ctx, featureStep);
	} finally {
		releaseSeqPaths(ctx.world, featureStep.seqPath);
	}
}

/** The dispatch context of a stepper's own call: actuality's registry, its world and its steppers, under the caller's capability. */
export const stepperContext = (world: TWorld, steppers: AStepper[]): DispatchContext => ({ registry: runRegistry(world), world, steppers });

/** Proves the statements a step states, in order, as one proof of the logic engine under the step's record. */
export const proveStatements = (ctx: DispatchContext, parent: TFeatureStep, statements: TFeatureStep[], targetHostId?: number): Promise<TActionResult> =>
	proverOf(ctx.world).proveStatements(ctx, parent, statements, targetHostId);

/** Proves a statement that ends with a read of a list, and returns the list as its combinators make it, or the statement's
 *  failure, which is a refusal where the statement doesn't end with a read of a list. */
export async function provedList(ctx: DispatchContext, parent: TFeatureStep, statement: unknown): Promise<{ list: TList } | { failure: TActionResult }> {
	let read: TList | undefined;
	const listed = listedStatement(ctx.world, statement, [{ listing: (list) => ((read = list), list) }]);
	if ("refused" in listed) return { failure: actionNotOK(listed.refused) };
	const proved = await proveStatements(ctx, parent, listed);
	if (!proved.ok) return { failure: proved };
	if (read === undefined) return { failure: actionNotOK("the list's statement returned without its list; state a step that returns a list, such as show steps") };
	return { list: read };
}

/** What a node of a proof performs in place of a step's action: the proof of its statements, which its caller resolves. */
export type TPerform = () => Promise<TActionResult>;

/** Proves a step: a feature's line, a statement a step states, or a call a transport carries. Every surface calls it. */
export const proveStep = (ctx: DispatchContext, featureStep: TFeatureStep): Promise<TStepResult> => proverOf(ctx.world).prove(ctx, featureStep);

/**
 * Dispatches one call of a proof. It applies capability authorization, the beforeStep and afterStep cycles, event logging
 * and result tracking. A built-in's call performs the step's action. A node of a proof, such as a negation or a waypoint,
 * performs `perform`, whose result is the node's verdict.
 */
export async function dispatchStep(ctx: DispatchContext, featureStep: TFeatureStep, perform?: TPerform): Promise<TStepResult> {
	const { registry, world, steppers } = ctx;
	const call = inCall();
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
	const recorded = !(isRead(action.step) && featureStep.programmatic === true && call?.step === undefined);
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
	// authorizeToolCapability refuses a step that reads above its ceiling. A nested step is refused first where the chain its
	// call rests on lapsed since the call began.
	const statedAt = call?.readScope;
	const lapse = await lapseOf(world, call);
	const refusal =
		lapse === undefined
			? refusalOf(() => authorizeToolCapability(tool.descriptor, call, statedAt !== undefined && "ceiling" in statedAt ? statedAt.ceiling : undefined))
			: new RefusedCall(authorityRefusal(`${method}: ${lapse}`));
	// A feature's or a scenario's start is recorded without the step's cycles, after its caller's capability is checked.
	if (action.actionName === FEATURE_START || action.actionName === SCENARIO_START) {
		if (refusal !== undefined) throw refusal;
		const started = await writeStepStart(world, featureStep, {}, { ranVia: "local" }, callOf());
		await writeStepEnd(world, started, { status: RECORDED_STATUS.completed });
		return stepResultOf({ ok: true }, action, start, Timer.since(), featureStep);
	}
	const authorization = authorizationOf(call, tool.descriptor.capability);
	// The step as its records state it. A domain's `recordedAs` replaces a value too large to repeat in the records.
	const stated = asRecorded(featureStep, world.domains);
	const called = { stepperName: action.stepperName, actionName: action.actionName, stepValuesMap: stated.action.stepValuesMap };
	let started: TStepRecord | undefined;
	if (recorded) {
		await moveActuality(world, stepStartEvent(stated, called, tool.isAsync, world.clock.now()));
		started = await writeStepStart(world, stated, authorization, { ranVia: tool.transport, ranOn: tool.descriptor.remoteOrigin }, callOf());
	}
	// A refused call ends as failed with the refusal, so its record states why it didn't run, and the refusal reaches the caller.
	if (refusal !== undefined) {
		if (started) {
			await moveActuality(world, stepEndEvent(stated, called, { status: STATUS.failed, error: refusal.message, products: undefined }, world.clock.now()));
			await writeStepEnd(world, started, { status: RECORDED_STATUS.failed, verdict: VERDICT.refuted, error: refusal.message });
		}
		throw refusal;
	}
	// A log written while a substep runs doesn't report above the substep's level, except a warning or an error. The web
	// server marks an RPC call into a running instance as a substep, so the caller's narration doesn't appear among
	// actuality's steps.
	const persistedAsOf = (domain: string) => world.domains[normalizeDomainKey(domain)]?.topology?.persistedAs;
	const step = { seqPath: featureStep.seqPath.join("."), reportsAt: featureStep.isSubStep ? SUBSTEP_LEVEL : undefined, writes: stepWrites(action.step, method, persistedAsOf) };
	let actionResult: TActionResult | undefined;
	let lastStepResult: TStepResult | undefined;
	await runInCall(nestedOf(call, step), () =>
		runAsWork(`the step ${step.seqPath}, ${featureStep.in}`, async () => {
			let doAction = true;
			while (doAction) {
				await doStepperCycle(steppers, "beforeStep", <TBeforeStep>{ featureStep });
				// The handler validates the step's products against the step's domain. A tool of another host or process
				// validates them where it runs.
				actionResult = await (perform === undefined ? tool.handler(featureStep, world) : perform());
				if (actionResult.ok) {
					if (actionResult.products && recorded) actionResult = { ...actionResult, products: { ...actionResult.products, [TRACE_SEQ_PATH]: featureStep.seqPath } };
					actionResult = augmentViewHypermedia(world, action.step, actionResult, steppers);
					// A fact is a record of actuality. Actuality doesn't record a read over a transport as a step or assert its products.
					if (recorded) await autoAssertProducts(world, { actuality: actualityFeatureOf(world.tag), path: featureStep.seqPath }, action.step, actionResult);
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
		stepEndEvent(stated, called, { status: ended, error, products: retainedProducts(actionResult.products, productsRetained(world, action.step)) }, world.clock.now()),
	);
	// A call a transport carries states what it read back, since its caller reads the result and not a line.
	const result = featureStep.programmatic === true && actionResult.products !== undefined ? { result: resultText(actionResult.products) } : {};
	const verdict = verdictOf(actionResult);
	await writeStepEnd(world, started, {
		status: RECORDED_STATUS[ended],
		verdict,
		...(error === undefined ? {} : { error }),
		...entailmentRecorded(actionResult.products),
		...(step.writes === undefined ? {} : { refusedWrites: step.writes.refused }),
		...(actionResult.contract === undefined ? {} : { contract: actionResult.contract.checks }),
		...shown(viewShown(actionResult.products)),
		...result,
	});
	return lastStepResult;
}

/** Returns why the chain a nested step's call rests on doesn't hold now, as actuality's authority reads its expiry and its
 *  revocation records at the time of the step, or undefined where it holds or the step isn't nested in a call that rests on a
 *  chain. A call that outlives its chain stops at its next nested step. */
async function lapseOf(world: TWorld, call: TCallContext | undefined): Promise<string | undefined> {
	if (!isNested(call) || call?.restsOn === undefined) return undefined;
	return await heldAuthority(world.runtime, "checking the chain a nested step rests on").lapsed(call.restsOn);
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
 *  ask that holds the call, and the agent to which the call is attributed. */
function callOf(): TStepCall {
	const { ask, attributedTo } = { ...inCall() };
	return { accessLevel: writtenLevel(SEQ_PATH_ACCESS), ...(ask === undefined ? {} : { askedIn: ask }), ...(attributedTo === undefined ? {} : { attributedTo }) };
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
	const products = retainedProducts(actionResult.products, productsRetained(world, step));
	if (!products) return;
	const store = world.shared.getStore();
	const { domain, fields } = contractProducts(step);
	if (domain) {
		if (isViewOnlyDomain(world, domain)) return;
		await assertFact(store, stepName, { domain: normalizeDomainKey(domain), value: products });
		return;
	}
	if (fields) {
		for (const [field, domainKey] of Object.entries(fields)) {
			if (!(field in products)) continue;
			if (isViewOnlyDomain(world, domainKey)) continue;
			await assertFact(store, stepName, { domain: normalizeDomainKey(domainKey), value: products[field], field });
		}
	}
}

/**
 * Creates a step's record when the step starts, so an individual created during the step can link to it by a graph edge.
 * One write states every required field, so a concurrent reader, such as getClusteredQuads on a polling tick, doesn't read a
 * step without its generatedAtTime, which fails the SeqPath schema. Dispatch allocates each step's path once, so a store that
 * holds a record at the path refuses the start. Returns the record, which the step's end writes again with how it ended.
 */
async function writeStepStart(world: TWorld, featureStep: TFeatureStep, authorization: TStepAuthorization, ran: TStepRan, call: TStepCall): Promise<TStepRecord> {
	const record = startRecord(actualityFeatureOf(world.tag), featureStep, authorization, ran, call, recordTime(world));
	await world.shared.getStore().create({ "@type": SEQ_PATH_LABEL, ...record });
	return record;
}

/** Writes a step's record when the step ends: its start with how it ended, in one write. */
async function writeStepEnd(world: TWorld, start: TStepRecord, ended: TStepEnded): Promise<void> {
	await world.shared.getStore().merge({ "@type": SEQ_PATH_LABEL, ...endRecord(start, ended, recordTime(world)) });
}
