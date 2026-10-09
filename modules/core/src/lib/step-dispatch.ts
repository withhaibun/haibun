import { AStepper, type TStepperStep, type TFeatureStep, type TStepAction, type TBeforeStep, type TAfterStep, type TAfterStepResult } from "./astepper.js";
import type { TWorld } from "./world.js";
import type { TActionResult, TStepResult } from "../schema/protocol.js";
import { TRACE_SEQ_PATH, Timer, FEATURE_START, SCENARIO_START, stepLevel, SUBSTEP_LEVEL, LIFECYCLE_STATUS, type TStepEnd } from "../schema/protocol.js";
import { streamContext } from "./step-stream-context.js";
import type { TFeatureSteps } from "../schema/protocol.js";
import { actionNotOK } from "./util/index.js";
import { itemAt } from "./util/item-at.js";
import { isWrittenByCaller, normalizeDomainKey } from "./domains.js";
import { assertFact, holdsFactOf } from "./records/pipelines/facts.js";
import { doStepperCycle } from "./stepper-cycles.js";
import { actingAs, callerHolds, readingAsStated, readScope, runInStep, runInvoking, runReadingAsHeld, runStatedAt } from "./capability-context.js";
import { capabilityAllows } from "./actions.js";
import { LinkRelations, SEQ_PATH_LABEL, SEQ_PATH_STATUS, type SeqPathStatus } from "./resources.js";
import { SEQ_PATH_FIELD, calledOf, executionOf, formatRecordName, type TRecordName } from "./seq-path.js";
import { StepRegistry, stepMethodName, hostScopedMethodName, authorizeToolCapability } from "./step-registry.js";
import { augmentViewHypermedia, isViewOnlyDomain } from "./step-hypermedia.js";

/** The products kept on a step's lifecycle event: all by default, undefined for `false`, else the subset the filter returns. */
export function retainedProducts(
	products: Record<string, unknown> | undefined,
	retain: boolean | ((p: Record<string, unknown>) => Record<string, unknown> | undefined) | undefined,
): Record<string, unknown> | undefined {
	if (retain === undefined || retain === true) return products;
	if (retain === false || products === undefined) return undefined;
	return retain(products);
}

const MAX_DISPATCH_SEQPATH = 50;

/** How a step is dispatched. `grantedCapability` is the action the call invoked. `held` is what its caller holds, and it
 *  bounds what the step reads. A holder in this process invokes from what it holds, so it passes one list for both. */
export type DispatchContext = { registry: StepRegistry; world: TWorld; steppers: AStepper[]; grantedCapability?: string | string[]; held?: string | string[] };

/** The number of a feature's most recent finished steps whose results a reader can read in full. foldStep reduces every
 *  step into the feature's step totals, and the totals don't hold the steps. */
export const RESULTS_READ_IN_FULL = 1000;

/** Adds one finished step to its feature's step totals: the count, the first start, the last end and the failure. */
export function foldStep(steps: TFeatureSteps, result: TStepResult): void {
	steps.count += 1;
	if (result.start !== undefined && (steps.firstStart === undefined || result.start < steps.firstStart)) steps.firstStart = result.start;
	if (result.end !== undefined && (steps.lastEnd === undefined || result.end > steps.lastEnd)) steps.lastEnd = result.end;
	if (result.ok) return;
	if (steps.failed === undefined || (ownFailure(result) && !ownFailure(steps.failed))) steps.failed = result;
}

/** Whether a failure is the feature's own. A speculative statement's failure is expected. A synthetic dispatch has a
 *  negative seqPath index, and its failure is the failure of the step that dispatched it. */
const ownFailure = (result: TStepResult): boolean => result.intent?.mode !== "speculative" && !result.seqPath?.some((n) => n < 0);

/**
 * Dispatches a step. Feature execution, FlowRunner, RPC and MCP call dispatchStep for every step. It applies capability
 * authorization, the beforeStep and afterStep cycles, event logging and result tracking to each step.
 */
export async function dispatchStep(ctx: DispatchContext, featureStep: TFeatureStep): Promise<TStepResult> {
	const { registry, world, steppers } = ctx;
	// A capability the dispatch context states takes precedence over callerHolds(). A step dispatched from inside another
	// step invokes from what the caller holds, under the chain the caller presented. Its action is the one in that chain
	// that allows it. The route that dispatched the step doesn't change whether it is refused, and a step doesn't run
	// beyond what that chain holds. A statement that narrows authority sets what its own statements hold in the same way.
	// `holding only` is one such statement.
	const grantedCapability = ctx.grantedCapability ?? callerHolds();
	const held = ctx.held ?? grantedCapability;
	const { action } = featureStep;
	const start = Timer.since();

	if (!world.runtime.stepResults) world.runtime.stepResults = [];

	// A read made into a running instance returns its result without a record. Reading actuality isn't an act of
	// actuality. A page that follows actuality sends a read on every announcement. Each such read recorded as a step would
	// write a record, announce it to every page and keep a result in this process for as long as the process runs.
	//
	// Every transport marks the steps it carries programmatic. A read that a feature states in its own body is a step of
	// actuality, whether the line reads directly or a combinator runs the read beneath it. In `set x from <a read>` the
	// feature reads, and the read's result is the step's result. The rule tests `programmatic` and not `isSubStep`, because
	// a read beneath a combinator is also a substep, and actuality records it.
	const recorded = !(action.step.read === true && featureStep.programmatic === true);
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
		foldStep((world.runtime.steps ??= { count: 0 }), result);
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

	if (world.runtime.exhaustionError) {
		return pushAndReturn(stepResultFromActionResult(actionNotOK(`Execution halted: ${world.runtime.exhaustionError}`), action, start, Timer.since(), featureStep));
	}
	if (featureStep.seqPath.length > MAX_DISPATCH_SEQPATH) {
		const msg = `Step depth ${featureStep.seqPath.length} exceeds the limit of ${MAX_DISPATCH_SEQPATH}. Check this step for infinite recursion: ${featureStep.in}`;
		world.runtime.exhaustionError = msg;
		return pushAndReturn(stepResultFromActionResult(actionNotOK(msg), action, start, Timer.since(), featureStep));
	}

	const isLifecycle = action.actionName === FEATURE_START || action.actionName === SCENARIO_START;
	if (isLifecycle) {
		await emitSeqPathStart(world, featureStep, {}, { ranVia: "local" });
		await emitSeqPathEnd(world, featureStep, SEQ_PATH_STATUS.passed);
		return stepResultFromActionResult({ ok: true }, action, start, Timer.since(), featureStep);
	}

	const bareMethod = stepMethodName(action.stepperName, action.actionName);
	const method = featureStep.targetHostId !== undefined ? hostScopedMethodName(featureStep.targetHostId, bareMethod) : bareMethod;
	const tool = registry.get(method);
	if (!tool) {
		// The refusal for a step the registry doesn't hold includes the step's description, as the refusal for an unresolved
		// line states its reason.
		const described = action.step.description ? `: ${action.step.description}` : "";
		return pushAndReturn(stepResultFromActionResult(actionNotOK(`The registry doesn't hold ${method}${described}. Load its stepper.`), action, start, Timer.since(), featureStep));
	}

	// The read scope in force where the statement was stated. Its arguments are read in this scope, and
	// authorizeToolCapability refuses a step that reads above its ceiling.
	const statedAt = readScope();
	authorizeToolCapability(tool.descriptor, { invoked: grantedCapability, held }, statedAt !== undefined && "ceiling" in statedAt ? statedAt.ceiling : undefined);
	// The authorization the step's own record states. The record states the invoked action that allows the step and the
	// actions the caller held, where the caller isn't actuality acting as itself. It states the principal that proved its
	// identity, where one did. authorizeToolCapability throws on a refusal, so a record with these fields records an
	// allowed call.
	const authorization: TStepAuthorization = {
		...(!capabilityAllows(grantedCapability, "*")
			? { invoked: [grantedCapability ?? []].flat().find((action) => capabilityAllows(action, tool.descriptor.capability)), held: [held ?? []].flat().join(", ") || undefined }
			: {}),
		controller: actingAs(),
	};
	// The step as its records state it. A domain's `recordedAs` replaces a value too large to repeat in the records.
	const stated = asRecorded(featureStep, world.domains);
	if (recorded) {
		world.eventLogger.stepStart(stated, action.stepperName, action.actionName, {}, stated.action.stepValuesMap, tool.isAsync);
		await emitSeqPathStart(world, stated, authorization, { ranVia: tool.transport, ranOn: tool.descriptor.remoteOrigin });
	}
	// A log written while a substep runs doesn't report above the substep's level, except a warning or an error. The web
	// server marks an RPC call into a running instance as a substep, so the caller's narration doesn't appear among
	// actuality's steps.
	const step = { seqPath: featureStep.seqPath.join("."), reportsAt: featureStep.isSubStep ? SUBSTEP_LEVEL : undefined };
	let actionResult: TActionResult | undefined;
	let lastStepResult: TStepResult | undefined;
	await runInStep(step, () =>
		runInvoking({ invoked: grantedCapability, held }, () =>
			runStatedAt(statedAt, () =>
				// The step reads at the broadest read its caller holds. A caller that doesn't hold a read action is refused each
				// read and write of records, so a step doesn't read a record for a caller who couldn't read that record.
				runReadingAsHeld(held, async () => {
					let doAction = true;
					while (doAction) {
						await doStepperCycle(steppers, "beforeStep", <TBeforeStep>{ featureStep });
						const preconditionError = await checkInputPreconditions(world, tool.paramDomainKeys, featureStep);
						if (preconditionError) {
							actionResult = actionNotOK(preconditionError);
							lastStepResult = stepResultFromActionResult(actionResult, action, start, Timer.since(), stated);
							keep(lastStepResult);
							// Each step that runs a beforeStep cycle also runs an afterStep cycle, so a stepper closes what it opened for that step.
							await doStepperCycle(steppers, "afterStep", <TAfterStep>{ featureStep, actionResult }, action.actionName);
							doAction = false;
							continue;
						}
						// The handler validates the step's products against the step's domain. A tool of another host or process
						// validates them where it runs.
						actionResult = await tool.handler(featureStep, world);
						if (actionResult.ok) {
							if (actionResult.products) actionResult = { ...actionResult, products: { ...actionResult.products, [TRACE_SEQ_PATH]: featureStep.seqPath } };
							actionResult = augmentViewHypermedia(world, action.step, actionResult, steppers);
							// A fact is a record of actuality. Actuality doesn't record a read over a transport as a step or assert its products.
							if (recorded) await autoAssertProducts(world, { execution: executionOf(world.tag), path: featureStep.seqPath }, action.step, actionResult);
						}
						if (!actionResult.ok && featureStep.intent?.mode !== "speculative") {
							world.eventLogger.log(featureStep, "error", actionResult.errorMessage);
						}
						const placed = stepResultFromActionResult(actionResult, action, start, Timer.since(), stated);
						place(placed);
						const instructions: Array<TAfterStepResult | undefined> = await doStepperCycle(steppers, "afterStep", <TAfterStep>{ featureStep, actionResult }, action.actionName);
						doAction = instructions.some((i) => i?.rerunStep);
						// An afterStep cycle can fail a step that passed, so actuality counts the outcome afterStepOutcome computes.
						actionResult = afterStepOutcome(actionResult, instructions);
						lastStepResult = stepResultFromActionResult(actionResult, action, start, placed.end ?? Timer.since(), stated);
						settle(placed, lastStepResult);
					}
				}),
			),
		),
	);
	if (!actionResult || !lastStepResult) {
		throw new Error(`${action.stepperName}.${action.actionName} didn't record an action result`);
	}
	const ok = actionResult.ok;
	if (!recorded) return lastStepResult;
	// A step that doesn't pass while its caller's stream is aborted ends as stopped. The caller stopped it, so the step didn't fail.
	const ended: TStepEnd = ok ? LIFECYCLE_STATUS.completed : streamContext.getStore()?.signal.aborted ? LIFECYCLE_STATUS.stopped : LIFECYCLE_STATUS.failed;
	world.eventLogger.stepEnd(
		stated,
		action.stepperName,
		action.actionName,
		ended,
		actionResult.ok ? undefined : actionResult.errorMessage,
		{},
		stated.action.stepValuesMap,
		retainedProducts(actionResult.products, action.step.retainProducts),
	);
	await emitSeqPathEnd(world, featureStep, SEQ_PATH_STATUS_OF[ended], actionResult.ok ? undefined : actionResult.errorMessage, viewShown(actionResult.products));
	return lastStepResult;
}

/** Returns a step's result after the afterStep cycles. A cycle that fails a passing step states a reason, and the step
 *  fails with that reason. A step that failed keeps its own reason. A cycle that returns `nextStep` passes the step. */
function afterStepOutcome(result: TActionResult, instructions: Array<TAfterStepResult | undefined>): TActionResult {
	const failure = instructions.find((i) => i?.failed)?.failed;
	const { products, controlSignal, artifact, protocol } = result;
	if (failure) return result.ok ? { products, controlSignal, artifact, protocol, ok: false, errorMessage: failure } : result;
	if (instructions.some((i) => i?.nextStep)) return { products, controlSignal, artifact, protocol, ok: true };
	return result;
}

function stepResultFromActionResult(actionResult: TActionResult, action: TStepAction, start: number, end: number, featureStep: TFeatureStep): TStepResult {
	return {
		...actionResult,
		name: action.actionName,
		in: featureStep.in,
		path: featureStep.source?.path,
		lineNumber: featureStep.source?.lineNumber,
		seqPath: featureStep.seqPath,
		intent: featureStep.intent,
		start,
		end,
	};
}

/**
 * Checks that each parameter whose domain stands for a step's products has a term or at least one matching fact. A value
 * that a caller writes doesn't have a fact to stand for it. Its domain validates the value, including an empty value.
 * Returns an error message for the first unsatisfied precondition, else undefined.
 */
async function checkInputPreconditions(world: TWorld, paramDomainKeys: ReadonlyMap<string, string>, featureStep: TFeatureStep): Promise<string | undefined> {
	const stepValuesMap = featureStep.action.stepValuesMap ?? {};
	for (const [param, normalized] of paramDomainKeys) {
		if (isWrittenByCaller(normalized, world.domains)) continue;
		const stepValue = stepValuesMap[param];
		// A term the gwta captures satisfies the precondition. Argument population resolves and validates the term before the
		// action runs.
		if (stepValue?.term !== undefined && stepValue.term !== "") continue;
		// The facts for an input are read at the statement's read ceiling, as its arguments are.
		if (!(await readingAsStated(() => holdsFactOf(world.shared.getStore(), normalized))))
			return `precondition-not-satisfied: domain "${normalized}" doesn't have an asserted fact or a resolved value for {${param}}. Run a step that produces this domain before this step, or give this parameter a value.`;
	}
	return undefined;
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
	const generatedAtTime = new Date().toISOString();
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

/** The authorization a step's own record states. A step actuality runs as itself holds every action, so its record
 *  doesn't state the invoked and held actions. The record of a caller's step states both. A record states the principal
 *  that proved its identity, where one did. */
type TStepAuthorization = { invoked?: string; held?: string; controller?: string };

/** Returns a step as its records state it. The step's line and values state the text that `recordedAs` returns in place
 *  of a value, where the value's domain declares `recordedAs`. */
function asRecorded(featureStep: TFeatureStep, domains: TWorld["domains"]): TFeatureStep {
	const values = featureStep.action.stepValuesMap;
	if (!values) return featureStep;
	const restated = Object.entries(values).flatMap(([name, value]) => {
		const recordedAs = value.domain ? domains[value.domain]?.recordedAs : undefined;
		return recordedAs && value.term ? [{ name, value, term: value.term, stated: recordedAs(value.value ?? value.term) }] : [];
	});
	if (restated.length === 0) return featureStep;
	const statedValues = { ...values };
	let line = featureStep.in;
	for (const { name, value, term, stated } of restated) {
		statedValues[name] = { ...value, term: stated, value: stated };
		line = line.split(term).join(stated);
	}
	return { ...featureStep, in: line, action: { ...featureStep.action, stepValuesMap: statedValues } };
}

/**
 * Writes a SeqPath individual when a step starts, so an individual created during the step can link to it by a graph
 * edge. `emitSeqPathEnd` writes the status and endedAtTime after the action completes.
 */
async function emitSeqPathStart(world: TWorld, featureStep: TFeatureStep, authorization: TStepAuthorization, ran: { ranVia: string; ranOn?: string }): Promise<void> {
	const store = world.shared.getStore();
	const execution = executionOf(world.tag);
	const id = formatRecordName({ execution, path: featureStep.seqPath });
	// One upsert writes every required field. Sequential set() calls would let a concurrent reader read a SeqPath without
	// its generatedAtTime, which fails the SeqPathSchema check. getClusteredQuads on a polling tick is one such reader.
	const record: Record<string, unknown> = {
		[SEQ_PATH_FIELD.id]: id,
		// The execution that contains this step, as a field as well as the leading part of its id. A store filters on a
		// field, so one execution's steps can be read, counted and spanned together.
		[SEQ_PATH_FIELD.execution]: execution,
		[SEQ_PATH_FIELD.recordedAtTime]: new Date().toISOString(),
		[SEQ_PATH_FIELD.stepText]: featureStep.in,
		// The stepper and action that ran, beside the line's text. Without this field a step's record states only the
		// words of the line.
		[SEQ_PATH_FIELD.called]: calledOf(featureStep.action.stepperName, featureStep.action.actionName),
		[SEQ_PATH_FIELD.actionStatus]: SEQ_PATH_STATUS.running,
		[SEQ_PATH_FIELD.generatedAtTime]: new Date().toISOString(),
		// Written for every step, including the default mode. A query for the steps that weren't speculative matches only
		// where ordinary steps state their mode as well.
		[SEQ_PATH_FIELD.mode]: featureStep.intent?.mode ?? "authoritative",
		[SEQ_PATH_FIELD.ranVia]: ran.ranVia,
		// A call made into a running instance is a step actuality records. Its record has the same level as its events. That
		// level is below the level of actuality's own steps, so a reader of actuality isn't shown the calls of other readers.
		[SEQ_PATH_FIELD.level]: stepLevel(featureStep.isSubStep),
		...(ran.ranOn === undefined ? {} : { [SEQ_PATH_FIELD.ranOn]: ran.ranOn }),
	};
	if (authorization.invoked) record[SEQ_PATH_FIELD.capabilityAction] = authorization.invoked;
	if (authorization.held) record[SEQ_PATH_FIELD.allowedAction] = authorization.held;
	if (authorization.controller) record[LinkRelations.PERFORMED_BY.rel] = authorization.controller;
	if (featureStep.source?.path) record[SEQ_PATH_FIELD.path] = featureStep.source.path;
	if (featureStep.seqPath.length > 1) {
		record[LinkRelations.PART_OF.rel] = formatRecordName({ execution, path: featureStep.seqPath.slice(0, -1) });
		const lastIndex = itemAt(featureStep.seqPath, featureStep.seqPath.length - 1);
		if (lastIndex > 0) {
			record[LinkRelations.PRECEDED_BY.rel] = formatRecordName({ execution, path: [...featureStep.seqPath.slice(0, -1), lastIndex - 1] });
		}
	}
	await store.upsertIndividual(SEQ_PATH_LABEL, record);
}

/** Returns the name of the view a step showed, where it showed one. The step's products carry the view's declared name
 *  as `view`. The view's declaration states its appearance. */
function viewShown(products: Record<string, unknown> | undefined): string | undefined {
	const view = products?.view;
	return typeof view === "string" ? view : undefined;
}

/** The status a step's record states for how the step ended. */
const SEQ_PATH_STATUS_OF: Record<TStepEnd, SeqPathStatus> = { completed: SEQ_PATH_STATUS.passed, failed: SEQ_PATH_STATUS.failed, stopped: SEQ_PATH_STATUS.stopped };

async function emitSeqPathEnd(world: TWorld, featureStep: TFeatureStep, status: SeqPathStatus, error?: string, showed?: string): Promise<void> {
	const store = world.shared.getStore();
	const id = formatRecordName({ execution: executionOf(world.tag), path: featureStep.seqPath });
	await store.set(id, SEQ_PATH_FIELD.actionStatus, status, SEQ_PATH_LABEL);
	const now = new Date().toISOString();
	await store.set(id, SEQ_PATH_FIELD.endedAtTime, now, SEQ_PATH_LABEL);
	// Written again, so a read of the records written since a given time returns the step's end.
	await store.set(id, SEQ_PATH_FIELD.recordedAtTime, now, SEQ_PATH_LABEL);
	if (error) await store.set(id, SEQ_PATH_FIELD.error, error, SEQ_PATH_LABEL);
	if (showed) await store.set(id, SEQ_PATH_FIELD.showed, showed, SEQ_PATH_LABEL);
}
