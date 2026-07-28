import { z } from "zod";
import { AStepper, type TStepperStep, type TFeatureStep, type TStepAction, type TBeforeStep, type TAfterStep, type TAfterStepResult } from "./astepper.js";
import type { TWorld } from "./world.js";
import type { TActionResult, TStepResult, TSeqPath } from "../schema/protocol.js";
import { TRACE_SEQ_PATH, Timer, FEATURE_START, SCENARIO_START, DispatchTraceArtifact } from "../schema/protocol.js";
import { actionNotOK } from "./util/index.js";
import { normalizeDomainKey } from "./domains.js";
import { OBSERVATION_GRAPH, FACT_GRAPH, assertFact, getFact, queryFacts } from "./working-memory.js";
import { doStepperCycle } from "./stepper-cycles.js";
import { LinkRelations, SEQ_PATH_LABEL, SEQ_PATH_STATUS } from "./resources.js";
import { SEQ_PATH_FIELD, formatSeqPath } from "./seq-path.js";
import { StepRegistry, stepMethodName, hostScopedMethodName, authorizeToolCapability } from "./step-registry.js";
import { getZcapAuthority, ZCAP_TOKEN_KEY } from "./zcap-authority.js";
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
	const token = world.runtime.keys?.[ZCAP_TOKEN_KEY] as string | undefined;
	if (!token) return undefined;
	const granted = getZcapAuthority(world.runtime)?.resolveBearer(token);
	return granted && granted.length > 0 ? granted : undefined;
}

export async function dispatchStep(ctx: DispatchContext, featureStep: TFeatureStep): Promise<TStepResult> {
	const { registry, world, steppers } = ctx;
	// A caller that supplied a capability decides; otherwise the active bearer token does, which is what makes
	// `with token, <step>` mean what it says: the step runs under that token's authority. Without this a gated step
	// was unreachable through a token, so a granted invocation could never carry one out.
	const grantedCapability = ctx.grantedCapability ?? bearerCapability(world);
	const { action } = featureStep;
	const start = Timer.since();

	if (!world.runtime.stepResults) world.runtime.stepResults = [];

	const pushAndReturn = (result: TStepResult): TStepResult => {
		world.runtime.stepResults.push(result);
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
		await emitSeqPathStart(world, featureStep);
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

	const usageKey = `${action.stepperName}.${action.actionName}`;
	const priorCount = ((await getFact(world, "count", usageKey, OBSERVATION_GRAPH.STEP_USAGE)) as number | undefined) ?? 0;
	await assertFact(world, "count", usageKey, priorCount + 1, OBSERVATION_GRAPH.STEP_USAGE);

	world.eventLogger.stepStart(featureStep, action.stepperName, action.actionName, {}, featureStep.action.stepValuesMap, tool.isAsync);
	await emitSeqPathStart(world, featureStep);
	const previousSeqPath = world.runtime.currentSeqPath;
	const currentSeqPathStr = featureStep.seqPath.join(".");
	world.runtime.currentSeqPath = currentSeqPathStr;
	world.eventLogger.currentSeqPath = currentSeqPathStr;
	let actionResult: TActionResult;
	let ok = true;
	let lastStepResult: TStepResult;
	try {
		let doAction = true;
		while (doAction) {
			await doStepperCycle(steppers, "beforeStep", <TBeforeStep>{ featureStep });
			const preconditionError = await checkInputPreconditions(world, action.step, featureStep);
			if (preconditionError) {
				actionResult = actionNotOK(preconditionError);
				lastStepResult = stepResultFromActionResult(actionResult, action, start, Timer.since(), featureStep, false);
				world.runtime.stepResults.push(lastStepResult);
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
			world.runtime.stepResults.push(lastStepResult);
			const instructions: TAfterStepResult[] = await doStepperCycle(steppers, "afterStep", <TAfterStep>{ featureStep, actionResult }, action.actionName);
			doAction = instructions.some((i) => i?.rerunStep);
			if (instructions.some((i) => i?.failed)) {
				ok = false;
			} else if (instructions.some((i) => i?.nextStep)) {
				actionResult = { ...actionResult, ok: true };
			}
		}
	} finally {
		world.runtime.currentSeqPath = previousSeqPath;
		world.eventLogger.currentSeqPath = previousSeqPath;
	}
	if (!actionResult || !lastStepResult) {
		throw new Error(`No action result recorded for ${action.stepperName}.${action.actionName}`);
	}
	ok = ok && actionResult.ok;
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
	lastStepResult.ok = ok;

	const end = Timer.since();
	await emitSeqPathEnd(world, featureStep, ok);
	world.eventLogger.emit(
		DispatchTraceArtifact.parse({
			id: `dispatch.${featureStep.seqPath.join(".")}`,
			timestamp: Date.now(),
			kind: "artifact",
			artifactType: "dispatch-trace",
			trace: {
				stepName: tool.name,
				transport: tool.transport ?? "local",
				remoteHost: tool.remoteHost,
				capabilityRequired: tool.capability,
				capabilityGranted: Array.isArray(grantedCapability) ? grantedCapability : grantedCapability ? [grantedCapability] : undefined,
				authorized: ok || !tool.capability,
				seqPath: featureStep.seqPath,
				durationMs: end - start,
				productKeys: ok && actionResult.products ? Object.keys(actionResult.products).filter((k) => !k.startsWith("_")) : undefined,
			},
		}),
	);

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

// --- RPC Message Schemas ---

/** Incoming JSON-RPC 2.0 request from client (POST /rpc/:method). */
export const RpcRequestSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.string(),
	method: z.string(),
	params: z.record(z.string(), z.unknown()).optional().default({}),
	capability: z.string().optional(),
	stream: z.boolean().optional(),
	/** Caller's seqPath for threading hierarchical step identity through RPC. */
	seqPath: z.array(z.number()).optional(),
});
export type TRpcRequest = z.infer<typeof RpcRequestSchema>;

/** Outgoing JSON-RPC 2.0 response to client. */
export const RpcResponseSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.string(),
	result: z.unknown().optional(),
	error: z.string().optional(),
});
export type TRpcResponse = z.infer<typeof RpcResponseSchema>;

/** Outgoing JSON-RPC 2.0 stream chunk to client. */
export const RpcStreamSchema = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.string(),
	stream: z.literal(true),
	data: z.unknown(),
});
export type TRpcStream = z.infer<typeof RpcStreamSchema>;

/**
 * Parse and validate an incoming RPC request.
 * Returns the parsed request or null if the message is not an RPC request.
 */
export function parseRpcRequest(raw: unknown): TRpcRequest | null {
	const result = RpcRequestSchema.safeParse(raw);
	return result.success ? result.data : null;
}

/**
 * Emit a SeqPath individual on step entry so child individuals created during the
 * step can link back to it as a real graph edge. Status and endedAtTime are
 * updated by `emitSeqPathEnd` after the action completes.
 */
async function emitSeqPathStart(world: TWorld, featureStep: TFeatureStep): Promise<void> {
	const store = world.shared.getStore();
	const id = formatSeqPath(featureStep.seqPath);
	// Single upsert with all required fields — partial writes via sequential set() let a concurrent
	// reader (e.g. getClusteredQuads from a polling tick) observe a SeqPath missing its
	// generatedAtTime and trip the SeqPathSchema invariant.
	const record: Record<string, unknown> = {
		[SEQ_PATH_FIELD.id]: id,
		[SEQ_PATH_FIELD.stepText]: featureStep.in,
		// What ran, beside what was asked for: a step's own record otherwise says only the words of the line.
		[SEQ_PATH_FIELD.called]: `${featureStep.action.stepperName}.${featureStep.action.actionName}`,
		[SEQ_PATH_FIELD.actionStatus]: SEQ_PATH_STATUS.running,
		[SEQ_PATH_FIELD.generatedAtTime]: new Date().toISOString(),
	};
	if (featureStep.source?.path) record[SEQ_PATH_FIELD.path] = featureStep.source.path;
	if (featureStep.seqPath.length > 1) {
		record[LinkRelations.PART_OF.rel] = formatSeqPath(featureStep.seqPath.slice(0, -1));
		const lastIndex = featureStep.seqPath[featureStep.seqPath.length - 1];
		if (lastIndex > 0) {
			record[LinkRelations.PRECEDED_BY.rel] = formatSeqPath([...featureStep.seqPath.slice(0, -1), lastIndex - 1]);
		}
	}
	await store.upsertIndividual(SEQ_PATH_LABEL, record);
}

async function emitSeqPathEnd(world: TWorld, featureStep: TFeatureStep, ok: boolean): Promise<void> {
	const store = world.shared.getStore();
	const id = formatSeqPath(featureStep.seqPath);
	const status = ok ? SEQ_PATH_STATUS.passed : SEQ_PATH_STATUS.failed;
	await store.set(id, SEQ_PATH_FIELD.actionStatus, status, SEQ_PATH_LABEL);
	await store.set(id, SEQ_PATH_FIELD.endedAtTime, new Date().toISOString(), SEQ_PATH_LABEL);
}
