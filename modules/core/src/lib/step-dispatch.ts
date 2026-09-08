import { z } from "zod";
import { AStepper, type TStepperStep, type TFeatureStep, type TStepAction, type TBeforeStep, type TAfterStep, type TAfterStepResult } from "./astepper.js";
import type { TWorld } from "./world.js";
import type { TActionResult, TStepResult, TSeqPath } from "../schema/protocol.js";
import { TRACE_SEQ_PATH, Timer, FEATURE_START, SCENARIO_START, stepLevel, SUBSTEP_LEVEL } from "../schema/protocol.js";
import { actionNotOK } from "./util/index.js";
import { normalizeDomainKey } from "./domains.js";
import { OBSERVATION_GRAPH, FACT_GRAPH, assertFact, getFact, queryFacts } from "./working-memory.js";
import { doStepperCycle } from "./stepper-cycles.js";
import { authorizedWith, runAuthorizedWith } from "./capability-context.js";
import { AccessLevelSchema, LinkRelations, SEQ_PATH_LABEL, SEQ_PATH_STATUS } from "./resources.js";
import { SEQ_PATH_FIELD, executionOf, formatRecordName, formatSeqPath } from "./seq-path.js";
import { StepRegistry, stepMethodName, hostScopedMethodName, authorizeToolCapability } from "./step-registry.js";
import { getAuthority, SESSION_TOKEN_KEY } from "./session-authority.js";
import { validateProducts } from "./tool-validation.js";
import { augmentViewHypermedia, isViewOnlyDomain } from "./step-hypermedia.js";

/** The products kept on a step's lifecycle event: all by default, none for `false`, else the subset the filter returns. */
export function retainedProducts(
	products: Record<string, unknown> | undefined,
	retain: boolean | ((p: Record<string, unknown>) => Record<string, unknown> | undefined) | undefined,
): Record<string, unknown> | undefined {
	if (retain === undefined || retain === true) return products;
	if (retain === false || products === undefined) return undefined;
	return retain(products);
}

const MAX_DISPATCH_SEQPATH = 50;

export type DispatchContext = {
	registry: StepRegistry;
	world: TWorld;
	steppers: AStepper[];
	grantedCapability?: string | string[];
};

/**
 * Unified step dispatch. Every step invocation — feature execution, FlowRunner,
 * RPC, MCP, subprocess — enters through here. Applies capability auth, lifecycle
 * cycles (beforeStep/afterStep), event logging, and result tracking uniformly.
 */
/** What the run's active bearer token grants, if one is set and an authority can resolve it. */
function bearerCapability(world: TWorld): string[] | undefined {
	const token = world.runtime.keys?.[SESSION_TOKEN_KEY] as string | undefined;
	if (!token) return undefined;
	const granted = getAuthority(world.runtime)?.resolveSession(token);
	return granted && granted.length > 0 ? granted : undefined;
}

/** The principal controlling the active bearer token, which is who a step dispatched under that token acts as. */
export function invokingPrincipal(world: TWorld): string | undefined {
	const token = world.runtime.keys?.[SESSION_TOKEN_KEY] as string | undefined;
	if (!token) return undefined;
	return getAuthority(world.runtime)?.resolveController(token);
}

export async function dispatchStep(ctx: DispatchContext, featureStep: TFeatureStep): Promise<TStepResult> {
	const { registry, world, steppers } = ctx;
	// A caller that states a capability decides; failing that, the capability the calling step was authorized with,
	// so a step dispatched from inside another is neither refused nor allowed for the route taken to it; failing
	// that, the active bearer token, which is what makes `with token, <step>` mean what it says.
	const grantedCapability = ctx.grantedCapability ?? authorizedWith() ?? bearerCapability(world);
	const { action } = featureStep;
	const start = Timer.since();

	if (!world.runtime.stepResults) world.runtime.stepResults = [];

	// A read made into a running instance is answered, not recorded: reading a run is not an act of the run. A page
	// following a run asks it what it holds on every announcement, and each such call recorded as a step would write a
	// record, announce it to every page and keep a result in this process for as long as it runs.
	const recorded = !(featureStep.isSubStep && action.step.read === true);
	const keep = (result: TStepResult): void => {
		if (recorded) world.runtime.stepResults.push(result);
	};
	const pushAndReturn = (result: TStepResult): TStepResult => {
		keep(result);
		return result;
	};

	if (world.runtime.exhaustionError) {
		return pushAndReturn(stepResultFromActionResult(actionNotOK(`Execution halted: ${world.runtime.exhaustionError}`), action, start, Timer.since(), featureStep, false));
	}
	if (featureStep.seqPath.length > MAX_DISPATCH_SEQPATH) {
		const msg = `Execution depth limit exceeded (${featureStep.seqPath.length} > ${MAX_DISPATCH_SEQPATH}). Possible infinite recursion in step: ${featureStep.in}`;
		world.runtime.exhaustionError = msg;
		return pushAndReturn(stepResultFromActionResult(actionNotOK(msg), action, start, Timer.since(), featureStep, false));
	}

	const isLifecycle = action.actionName === FEATURE_START || action.actionName === SCENARIO_START;
	if (isLifecycle) {
		await emitSeqPathStart(world, featureStep, undefined, { ranVia: "local" });
		await emitSeqPathEnd(world, featureStep, true);
		return stepResultFromActionResult({ ok: true }, action, start, Timer.since(), featureStep, true);
	}

	const bareMethod = stepMethodName(action.stepperName, action.actionName);
	const method = featureStep.targetHostId !== undefined ? hostScopedMethodName(featureStep.targetHostId, bareMethod) : bareMethod;
	const tool = registry.get(method);
	if (!tool) {
		return pushAndReturn(stepResultFromActionResult(actionNotOK(`Step not found in registry: ${method}`), action, start, Timer.since(), featureStep, false));
	}

	authorizeToolCapability(tool, grantedCapability);
	// What got through the gate, on the step's own record: which capability it required, what the caller held, and the
	// principal that held it. A refusal throws above, so a record with these fields is a record of an allowed call.
	const authorization: TStepAuthorization | undefined = tool.capability
		? {
				required: tool.capability,
				held: (Array.isArray(grantedCapability) ? grantedCapability.join(", ") : grantedCapability) || undefined,
				controller: invokingPrincipal(world),
			}
		: undefined;

	if (recorded) {
		const usageKey = `${action.stepperName}.${action.actionName}`;
		const priorCount = ((await getFact(world, "count", usageKey, OBSERVATION_GRAPH.STEP_USAGE)) as number | undefined) ?? 0;
		await assertFact(world, "count", usageKey, priorCount + 1, OBSERVATION_GRAPH.STEP_USAGE);
		world.eventLogger.stepStart(featureStep, action.stepperName, action.actionName, {}, featureStep.action.stepValuesMap, tool.isAsync);
		await emitSeqPathStart(world, featureStep, authorization, { ranVia: tool.transport ?? "local", ranOn: tool.remoteHost });
	}
	const previousSeqPath = world.runtime.currentSeqPath;
	const previousReportsAt = world.eventLogger.stepReportsAt;
	const currentSeqPathStr = featureStep.seqPath.join(".");
	world.runtime.currentSeqPath = currentSeqPathStr;
	world.eventLogger.currentSeqPath = currentSeqPathStr;
	// What is said while this step runs reports no more prominently than the step does, so a call made into a running
	// instance leaves the caller's own narration out of the run's history rather than among its steps.
	world.eventLogger.stepReportsAt = featureStep.isSubStep ? SUBSTEP_LEVEL : undefined;
	let actionResult: TActionResult;
	let ok = true;
	let lastStepResult: TStepResult;
	try {
		await runAuthorizedWith(grantedCapability, async () => {
			let doAction = true;
			while (doAction) {
				await doStepperCycle(steppers, "beforeStep", <TBeforeStep>{ featureStep });
				const preconditionError = await checkInputPreconditions(world, action.step, featureStep);
				if (preconditionError) {
					actionResult = actionNotOK(preconditionError);
					lastStepResult = stepResultFromActionResult(actionResult, action, start, Timer.since(), featureStep, false);
					keep(lastStepResult);
					ok = false;
					doAction = false;
					continue;
				}
				actionResult = await tool.handler(featureStep, world);
				if (actionResult.ok) {
					const productsError = validateProducts(action.stepperName, action.actionName, action.step, world, actionResult.products);
					if (productsError) {
						actionResult = actionNotOK(productsError);
					} else {
						if (actionResult.products) {
							actionResult = { ...actionResult, products: { ...actionResult.products, [TRACE_SEQ_PATH]: featureStep.seqPath } };
						}
						actionResult = augmentViewHypermedia(world, action.step, actionResult, steppers);
						await autoAssertProducts(world, action.step, actionResult);
					}
				}
				if (!actionResult.ok && actionResult.errorMessage && featureStep.intent?.mode !== "speculative") {
					world.eventLogger.log(featureStep, "error", actionResult.errorMessage);
				}
				lastStepResult = stepResultFromActionResult(actionResult, action, start, Timer.since(), featureStep, ok && actionResult.ok);
				keep(lastStepResult);
				const instructions: TAfterStepResult[] = await doStepperCycle(steppers, "afterStep", <TAfterStep>{ featureStep, actionResult }, action.actionName);
				doAction = instructions.some((i) => i?.rerunStep);
				if (instructions.some((i) => i?.failed)) {
					ok = false;
				} else if (instructions.some((i) => i?.nextStep)) {
					actionResult = { ...actionResult, ok: true };
				}
			}
		});
	} finally {
		world.runtime.currentSeqPath = previousSeqPath;
		world.eventLogger.currentSeqPath = previousSeqPath;
		world.eventLogger.stepReportsAt = previousReportsAt;
	}
	if (!actionResult || !lastStepResult) {
		throw new Error(`No action result recorded for ${action.stepperName}.${action.actionName}`);
	}
	ok = ok && actionResult.ok;
	lastStepResult.ok = ok;
	if (!recorded) return lastStepResult;
	world.eventLogger.stepEnd(
		featureStep,
		action.stepperName,
		action.actionName,
		ok,
		!ok ? actionResult.errorMessage : undefined,
		{},
		featureStep.action.stepValuesMap,
		retainedProducts(actionResult.products as Record<string, unknown> | undefined, action.step.retainProducts),
	);
	await emitSeqPathEnd(world, featureStep, ok, ok ? undefined : actionResult.errorMessage, viewShown(actionResult.products as Record<string, unknown> | undefined));
	return lastStepResult;
}

export function stepResultFromActionResult(actionResult: TActionResult, action: TStepAction, start: number, end: number, featureStep: TFeatureStep, ok: boolean): TStepResult {
	return {
		...actionResult,
		ok,
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
 * Verify each declared input domain has at least one matching fact OR that the
 * gwta-resolved value for that param validates against the domain schema. Returns
 * an error message when a precondition is unsatisfiable; undefined when all pass.
 */
async function checkInputPreconditions(world: TWorld, step: TStepperStep, featureStep: TFeatureStep): Promise<string | undefined> {
	if (!step.inputDomains) return undefined;
	const stepValuesMap = featureStep.action.stepValuesMap ?? {};
	for (const [param, domainKey] of Object.entries(step.inputDomains)) {
		const normalized = normalizeDomainKey(domainKey);
		const stepValue = stepValuesMap[param];
		// gwta-captured term covers the precondition: the dispatcher's existing
		// arg-population path resolves and validates it before the action runs.
		if (stepValue?.term !== undefined && stepValue.term !== "") continue;
		const facts = await queryFacts(world, normalized, FACT_GRAPH);
		if (facts.length === 0) return `precondition-not-satisfied: domain "${domainKey}" has no asserted facts and no resolved value for {${param}}`;
	}
	return undefined;
}

/**
 * Auto-assert step products into the facts graph using the step's declared
 * output domain(s). The seqPath is the fact identity so re-firing a step
 * upserts its assertion rather than duplicating it.
 *
 * View-only outputs (e.g. `show monitor` → `shu-monitor-column`) are skipped:
 * see `isViewOnlyDomain` for why.
 */
async function autoAssertProducts(world: TWorld, step: TStepperStep, actionResult: TActionResult): Promise<void> {
	if (!actionResult.products) return;
	const seqPathKey = world.runtime.currentSeqPath;
	if (!seqPathKey) {
		throw new Error(
			"autoAssertProducts: world.runtime.currentSeqPath is unset. dispatchStep must set currentSeqPath before invoking the action; if you see this, the dispatch path is missing the assignment.",
		);
	}
	if (step.productsDomain) {
		if (isViewOnlyDomain(world, step.productsDomain)) return;
		await assertFact(world, normalizeDomainKey(step.productsDomain), seqPathKey, actionResult.products, FACT_GRAPH);
		return;
	}
	if (step.productsDomains) {
		const products = actionResult.products as Record<string, unknown>;
		for (const [field, domainKey] of Object.entries(step.productsDomains)) {
			if (!(field in products)) continue;
			if (isViewOnlyDomain(world, domainKey)) continue;
			await assertFact(world, normalizeDomainKey(domainKey), `${seqPathKey}#${field}`, products[field], FACT_GRAPH);
		}
	}
}


/**
 * Emit a SeqPath individual on step entry so child individuals created during the
 * step can link back to it as a real graph edge. Status and endedAtTime are
 * updated by `emitSeqPathEnd` after the action completes.
 */
/** What a step required and what allowed it, for the step's own record. Written only where the step declares a
 *  capability, so an ordinary step's record gains nothing and a gated one says who got through it. The token itself is
 *  never written: a bearer token is the credential, so recording it would copy the credential into the graph. */
type TStepAuthorization = { required: string; held?: string; controller?: string };

async function emitSeqPathStart(world: TWorld, featureStep: TFeatureStep, authorization: TStepAuthorization | undefined, ran: { ranVia: string; ranOn?: string }): Promise<void> {
	const store = world.shared.getStore();
	const execution = executionOf(world.tag);
	const id = formatRecordName({ execution, path: featureStep.seqPath });
	// Single upsert with all required fields — partial writes via sequential set() let a concurrent
	// reader (e.g. getClusteredQuads from a polling tick) observe a SeqPath missing its
	// generatedAtTime and trip the SeqPathSchema invariant.
	const record: Record<string, unknown> = {
		[SEQ_PATH_FIELD.id]: id,
		// The run this step belongs to, as a field rather than only as the leading part of its id: a store filters on a
		// field, so a run can be read, counted and spanned as one run.
		[SEQ_PATH_FIELD.execution]: execution,
		[SEQ_PATH_FIELD.recordedAtTime]: new Date().toISOString(),
		[SEQ_PATH_FIELD.stepText]: featureStep.in,
		// What ran, beside what was asked for: a step's own record otherwise says only the words of the line.
		[SEQ_PATH_FIELD.called]: `${featureStep.action.stepperName}.${featureStep.action.actionName}`,
		[SEQ_PATH_FIELD.actionStatus]: SEQ_PATH_STATUS.running,
		[SEQ_PATH_FIELD.generatedAtTime]: new Date().toISOString(),
		// Written for every step, the default included: a reader asking for the steps that were NOT speculative can only
		// be answered if the ordinary ones say so as well.
		[SEQ_PATH_FIELD.mode]: featureStep.intent?.mode ?? "authoritative",
		[SEQ_PATH_FIELD.ranVia]: ran.ranVia,
		// A call made into a running instance is a step the run records, and reports as its events do: under the run's own
		// steps, so a reader of the run is not shown the traffic of whoever is reading it.
		[SEQ_PATH_FIELD.level]: stepLevel(featureStep.isSubStep),
		...(ran.ranOn === undefined ? {} : { [SEQ_PATH_FIELD.ranOn]: ran.ranOn }),
	};
	if (authorization) {
		record[SEQ_PATH_FIELD.capabilityAction] = authorization.required;
		if (authorization.held) record[SEQ_PATH_FIELD.allowedAction] = authorization.held;
		if (authorization.controller) record[LinkRelations.PERFORMED_BY.rel] = authorization.controller;
	}
	if (featureStep.source?.path) record[SEQ_PATH_FIELD.path] = featureStep.source.path;
	if (featureStep.seqPath.length > 1) {
		record[LinkRelations.PART_OF.rel] = formatRecordName({ execution, path: featureStep.seqPath.slice(0, -1) });
		const lastIndex = featureStep.seqPath[featureStep.seqPath.length - 1];
		if (lastIndex > 0) {
			record[LinkRelations.PRECEDED_BY.rel] = formatRecordName({ execution, path: [...featureStep.seqPath.slice(0, -1), lastIndex - 1] });
		}
	}
	await store.upsertIndividual(SEQ_PATH_LABEL, record);
}

/** The view a step showed, where it showed one: the name the site declares it under, which is what the step's products
 *  carry as `view`. What that view looks like is the declaration's to say. */
function viewShown(products: Record<string, unknown> | undefined): string | undefined {
	const view = products?.view;
	return typeof view === "string" ? view : undefined;
}

async function emitSeqPathEnd(world: TWorld, featureStep: TFeatureStep, ok: boolean, error?: string, showed?: string): Promise<void> {
	const store = world.shared.getStore();
	const id = formatRecordName({ execution: executionOf(world.tag), path: featureStep.seqPath });
	const status = ok ? SEQ_PATH_STATUS.passed : SEQ_PATH_STATUS.failed;
	await store.set(id, SEQ_PATH_FIELD.actionStatus, status, SEQ_PATH_LABEL);
	const now = new Date().toISOString();
	await store.set(id, SEQ_PATH_FIELD.endedAtTime, now, SEQ_PATH_LABEL);
	// Written again, so a reader asking for what was recorded since their last read is given the step's end.
	await store.set(id, SEQ_PATH_FIELD.recordedAtTime, now, SEQ_PATH_LABEL);
	if (error) await store.set(id, SEQ_PATH_FIELD.error, error, SEQ_PATH_LABEL);
	if (showed) await store.set(id, SEQ_PATH_FIELD.showed, showed, SEQ_PATH_LABEL);
}
