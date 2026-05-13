import { z } from "zod";
import { AStepper, type TStepperStep, type TFeatureStep, type TStepAction, type TBeforeStep, type TAfterStep, type TAfterStepResult } from "./astepper.js";
import type { TWorld } from "./world.js";
import { buildConcernCatalog, type TConcernCatalog } from "./hypermedia.js";
import type { TActionResult, TStepResult, TSeqPath } from "../schema/protocol.js";
import { HYPERMEDIA, TRACE_SEQ_PATH, Timer, FEATURE_START, SCENARIO_START, DispatchTraceArtifact } from "../schema/protocol.js";
import { namedInterpolation, mapInputToStepValues } from "./namedVars.js";
import { constructorName, actionNotOK } from "./util/index.js";
import { populateActionArgs } from "./populateActionArgs.js";
import { DOMAIN_STRING, normalizeDomainKey } from "./domains.js";
import { OBSERVATION_GRAPH, FACT_GRAPH, assertFact, getFact, queryFacts } from "./working-memory.js";
import { StepperRegistry, type StepDescriptor } from "./stepper-registry.js";
import { doStepperCycle } from "./stepper-cycles.js";
import { isVertexTopology, LinkRelations, SEQ_PATH_LABEL, SEQ_PATH_STATUS } from "./resources.js";
import { SEQ_PATH_FIELD, formatSeqPath } from "./seq-path.js";

/**
 * A registered step tool — the unit of dispatch for any transport (MCP, SSE, etc.).
 */
export type StepTool = {
	name: string;
	description: string;
	inputSchema: StepToolInputSchema;
	/** Zod schemas for each input parameter, keyed by parameter name. Used for runtime validation. */
	paramSchemas: Map<string, z.ZodType>;
	/** Domain key for each parameter, keyed by parameter name. Used for domain.coerce() after Zod validation. */
	paramDomainKeys: Map<string, string>;
	/** JSON Schema describing the products this step returns. Built from the step's productsDomain, productsDomains, or productsSchema. */
	outputSchema?: Record<string, unknown>;
	stepperName: string;
	stepName: string;
	/** The registered stepper-step definition. Carries productsDomain, productsDomains, productsSchema, capability, gwta, etc.
	 * Absent for proxy tools (RemoteStepperProxy, subprocess) where dispatch happens out-of-process. */
	stepDef?: TStepperStep;
	/**
	 * Optional capability label for permission gating (ZCAP-LD hook).
	 * Transports check this before dispatching. e.g. "GraphStepper:read", "LlmStepper:*"
	 */
	capability?: string;
	/** Transport type — set by proxy transports (remote, subprocess). Defaults to "local". */
	transport?: "local" | "remote" | "subprocess";
	/** Remote host URL — set by RemoteStepperProxy for dispatch tracing. */
	remoteHost?: string;
	/** True if the step action is an async function (observable execution time). */
	isAsync: boolean;
	handler: (featureStep: TFeatureStep, world: TWorld) => Promise<TActionResult>;
};

/**
 * Live-refreshable step registry. Single source of truth for all transports (SSE, MCP, subprocess).
 * Call refresh() to rebuild in-place when steppers change without restarting.
 */
export class StepRegistry {
	private tools = new Map<string, StepTool>();
	/** Names injected via set() — survive refresh() so transports (RemoteStepperProxy, subprocess) register once and stay live across per-feature rebuilds. */
	private injectedNames = new Set<string>();

	constructor(steppers: AStepper[], world: TWorld) {
		this.refresh(steppers, world);
	}

	/** Rebuild stepper-owned entries in-place. Externally-injected tools (via set()) are preserved. */
	refresh(steppers: AStepper[], world: TWorld): void {
		const next = buildStepRegistry(steppers, world);
		for (const name of this.injectedNames) {
			const existing = this.tools.get(name);
			if (existing) next.set(name, existing);
		}
		this.tools = next;
	}

	get(name: string): StepTool | undefined {
		return this.tools.get(name);
	}

	list(): StepTool[] {
		return Array.from(this.tools.values());
	}

	get size(): number {
		return this.tools.size;
	}

	has(name: string): boolean {
		return this.tools.has(name);
	}

	/** Inject or overwrite a single tool (used by transports to register remote/child steps). Survives refresh(). */
	set(tool: StepTool): void {
		this.tools.set(tool.name, tool);
		this.injectedNames.add(tool.name);
	}

	/** Remove an injected tool. Used by transport detach(). */
	unset(name: string): void {
		this.tools.delete(name);
		this.injectedNames.delete(name);
	}
}

/** Registry key for a step routed at a specific hostId: `${hostId}:${method}`. */
export function hostScopedMethodName(hostId: number, bareMethod: string): string {
	return `${hostId}:${bareMethod}`;
}

export type StepToolInputSchema = {
	type: "object";
	properties?: Record<string, { type?: string; description?: string; [key: string]: unknown }>;
	required?: string[];
	[key: string]: unknown;
};

/**
 * Build a registry of step tools from the given steppers.
 * Each key is `${stepperName}-${stepName}` (e.g. `MuskegStepper-getTypes`).
 * All steps are included. MCP filters `exposeMCP: false` separately.
 */
export function buildStepRegistry(steppers: AStepper[], world: TWorld): Map<string, StepTool> {
	const registry = new Map<string, StepTool>();

	for (const stepper of steppers) {
		const stepperName = constructorName(stepper);

		for (const [stepName, stepDef] of Object.entries(stepper.steps)) {
			const tool = createStepTool(stepperName, stepName, stepDef, world);
			registry.set(tool.name, tool);
		}
	}

	return registry;
}

export function createStepTool(stepperName: string, stepName: string, stepDef: TStepperStep, world: TWorld): StepTool {
	const { inputSchema, paramSchemas, paramDomainKeys } = buildInputSchema(stepDef, world);
	const name = stepMethodName(stepperName, stepName);
	validateInputDomains(stepperName, stepName, stepDef, paramDomainKeys);
	const resolvedOutputSchema = resolveOutputSchema(stepperName, stepName, stepDef, world);
	let outputSchema: Record<string, unknown> | undefined;
	if (resolvedOutputSchema) {
		try {
			outputSchema = z.toJSONSchema(resolvedOutputSchema) as Record<string, unknown>;
		} catch {
			/* skip if schema can't be converted */
		}
	}

	return {
		name,
		description: stepDef.gwta || stepName,
		inputSchema,
		paramSchemas,
		paramDomainKeys,
		outputSchema,
		stepperName,
		stepName,
		stepDef,
		capability: stepDef.capability,
		isAsync: stepDef.action.constructor.name === "AsyncFunction",
		handler: createStepHandler(stepperName, stepName, stepDef),
	};
}

/**
 * Validate input against a step tool's Zod schemas, then apply domain.coerce() if available.
 * Returns validated (and coerced) input on success, throws with descriptive errors on failure.
 * Pass world to enable domain coercion (aligns RPC dispatch with feature-file execution).
 */
export function validateToolInput(fromSeqPath: TSeqPath, tool: StepTool, input: Record<string, unknown>, world?: TWorld): Record<string, unknown> {
	const validated: Record<string, unknown> = { ...input };
	const errors: string[] = [];

	const required = tool.inputSchema.required || [];
	for (const key of required) {
		if (!(key in input) || input[key] === undefined) {
			errors.push(`"${key}": required`);
		}
	}

	for (const [key, value] of Object.entries(input)) {
		const schema = tool.paramSchemas.get(key);
		if (schema) {
			const result = schema.safeParse(value);
			if (result.success) {
				// Apply domain.coerce() after Zod validation if world is provided
				if (world) {
					const domainKey = tool.paramDomainKeys.get(key);
					const domain = domainKey ? world.domains?.[domainKey] : undefined;
					if (domain?.coerce) {
						validated[key] = domain.coerce({ value: result.data, domain: domainKey || "", term: key, origin: "defined" });
					} else {
						validated[key] = result.data;
					}
				} else {
					validated[key] = result.data;
				}
			} else {
				const issues = result.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
				errors.push(`"${key}" (value: ${JSON.stringify(value)}): ${issues}`);
			}
		}
	}

	if (errors.length) {
		throw new Error(`${tool.name} validation failed (caller: [${fromSeqPath.join(".")}]): ${errors.join(", ")}`);
	}

	return validated;
}

/**
 * Generate the canonical RPC method name for a step.
 * Used by both server (registry keys) and client (typed imports).
 *
 * Accepts either a stepper class/instance or a stepper name string.
 */
export function stepMethodName(stepperOrName: string | AStepper | { name: string }, stepName: string): string {
	const name = typeof stepperOrName === "string" ? stepperOrName : "steps" in stepperOrName ? constructorName(stepperOrName as AStepper) : stepperOrName.name;
	return `${name}-${stepName}`;
}

/**
 * Create a handler that populates args from featureStep.action.stepValuesMap,
 * calls stepDef.action, and returns TActionResult.
 *
 * All callers (feature loop, FlowRunner, RPC, MCP, subprocess) use the same signature.
 * External transports build a synthetic featureStep before calling.
 */
export function createStepHandler(stepperName: string, stepName: string, stepDef: TStepperStep): (featureStep: TFeatureStep, world: TWorld) => Promise<TActionResult> {
	return async (featureStep: TFeatureStep, world: TWorld): Promise<TActionResult> => {
		try {
			const args = await populateActionArgs(featureStep, world, world.runtime.steppers);
			return await stepDef.action(args, featureStep);
		} catch (caught) {
			const err = caught instanceof Error ? caught : new Error(String(caught));
			return actionNotOK(`${stepperName}-${stepName}: ${err.message}`);
		}
	};
}

/**
 * Build a TFeatureStep for a transport-originated call (RPC, MCP, subprocess).
 * Feature-file dispatch already has one; transports construct it from the tool +
 * raw input. Uses the same registered stepDef so downstream dispatch (augment,
 * autoAssert, preconditions) sees the identical shape both paths produce.
 */
export function buildFeatureStepForTransport(tool: StepTool, input: Record<string, unknown>, seqPath: TSeqPath): TFeatureStep {
	// Proxy tools (RemoteStepperProxy, subprocess) dispatch out-of-process and have no
	// local stepDef. Construct a carrier with just the description so the handler can run.
	const step = tool.stepDef ?? ({ gwta: tool.description, action: () => actionNotOK(`no in-process stepDef for ${tool.name}`) } as TStepperStep);
	return {
		in: tool.description,
		action: {
			stepperName: tool.stepperName,
			actionName: tool.stepName,
			step,
			stepValuesMap: mapInputToStepValues(input, tool.description),
		},
		seqPath,
		source: { path: "rpc" },
	};
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
export async function dispatchStep(ctx: DispatchContext, featureStep: TFeatureStep): Promise<TStepResult> {
	const { registry, world, steppers, grantedCapability } = ctx;
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
					actionResult = augmentViewHypermedia(world, action.step, actionResult);
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
		actionResult.products as Record<string, unknown> | undefined,
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
		path: featureStep.source.path,
		lineNumber: featureStep.source.lineNumber,
		seqPath: featureStep.seqPath,
		intent: featureStep.intent,
		start,
		end,
	};
}

export function capabilityAllows(granted: string | string[] | undefined, required: string): boolean {
	if (!granted) return false;
	const grantedValues = Array.isArray(granted) ? granted : [granted];
	return grantedValues.some((entry) => {
		if (entry === "*" || entry === required) return true;
		if (!entry.endsWith("*")) return false;
		const prefix = entry.slice(0, -1);
		return required.startsWith(prefix);
	});
}

export function authorizeToolCapability(tool: Pick<StepTool, "name" | "capability">, granted?: string | string[]): void {
	if (!tool.capability) return;
	if (capabilityAllows(granted, tool.capability)) return;
	throw new Error(`${tool.name}: capability ${tool.capability} required`);
}

/**
/**
 * Cross-check a step's declared `inputDomains` against the gwta-derived param-domain
 * bindings. Mismatch is a registration error — better to fail at boot than to leave
 * the goal-resolver with a graph that disagrees with dispatch.
 */
function validateInputDomains(stepperName: string, stepName: string, stepDef: TStepperStep, paramDomainKeys: Map<string, string>): void {
	if (!stepDef.inputDomains) return;
	for (const [param, declaredDomain] of Object.entries(stepDef.inputDomains)) {
		const gwtaDomain = paramDomainKeys.get(param);
		if (!gwtaDomain) {
			throw new Error(`step ${stepperName}.${stepName}: inputDomains.${param} declared as "${declaredDomain}" but gwta has no {${param}:...} slot`);
		}
		if (normalizeDomainKey(declaredDomain) !== gwtaDomain) {
			throw new Error(`step ${stepperName}.${stepName}: inputDomains.${param}="${declaredDomain}" disagrees with gwta {${param}:${gwtaDomain}}`);
		}
	}
}

/** Validate step products against the declared output schema; returns error string or undefined. */
export function validateProducts(stepperName: string, actionName: string, stepDef: TStepperStep, world: TWorld, products: unknown): string | undefined {
	const schema = resolveOutputSchema(stepperName, actionName, stepDef, world);
	if (!schema) return undefined;
	if (products === undefined || products === null) {
		return `step ${stepperName}.${actionName} declared an output schema but action returned no products`;
	}
	const result = schema.safeParse(products);
	if (result.success) return undefined;
	return `step ${stepperName}.${actionName} products failed schema validation: ${result.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`;
}

/**
 * Resolve a step's output schema from its declarations. Exactly one of `productsDomain`,
 * `productsDomains`, or `productsSchema` may be set:
 *   - `productsDomain` looks up a registered domain and uses its schema.
 *   - `productsDomains` looks up multiple domains and builds an object schema keyed by field.
 *   - `productsSchema` uses an inline Zod schema with no domain registration.
 * A step with none of these produces no typed output.
 */
function resolveOutputSchema(stepperName: string, stepName: string, stepDef: TStepperStep, world: TWorld): z.ZodType | undefined {
	const declared = [stepDef.productsDomain ? "productsDomain" : null, stepDef.productsDomains ? "productsDomains" : null, stepDef.productsSchema ? "productsSchema" : null].filter(
		Boolean,
	);
	if (declared.length > 1) {
		throw new Error(`step ${stepperName}.${stepName}: only one of productsDomain, productsDomains, productsSchema may be set (got: ${declared.join(", ")})`);
	}
	if (stepDef.productsDomain) {
		const domain = world.domains?.[normalizeDomainKey(stepDef.productsDomain)];
		if (!domain) throw new Error(`step ${stepperName}.${stepName}: productsDomain "${stepDef.productsDomain}" is not a registered domain`);
		return domain.schema;
	}
	if (stepDef.productsDomains) {
		const fields: Record<string, z.ZodType> = {};
		for (const [field, domainKey] of Object.entries(stepDef.productsDomains)) {
			const domain = world.domains?.[normalizeDomainKey(domainKey)];
			if (!domain) throw new Error(`step ${stepperName}.${stepName}: productsDomains.${field} = "${domainKey}" is not a registered domain`);
			fields[field] = domain.schema;
		}
		return z.object(fields);
	}
	if (stepDef.productsSchema) {
		return stepDef.productsSchema;
	}
	return undefined;
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
 * Inject hypermedia markers (`_type`, `_summary`, and where applicable `_component`,
 * `id`, `view`) into a step's products. The single source of truth is the registered
 * domain: every step with a `productsDomain` gets markers; their values come from the
 * domain's `ui` configuration. Steps with `productsSchema` (no domain registration) get
 * no markers — they are local typed outputs, not domain-scoped resources. Actions never
 * emit `_type` / `_summary` themselves.
 *
 * - `_type` is the registered `ui.component` if set, else the domain key.
 * - `_summary` is `ui.summary` — either a string template or a function taking the
 *   products object. Falls back to the domain key.
 * - `_component`, `id`, `view` are injected only when the domain has `ui.component`,
 *   because those markers exist for the SPA's pane-opener and are meaningless for
 *   diagnostic/data-only domains.
 *
 * If `_component` is already present in products (a step explicitly setting its own),
 * the entire augmentation is skipped to preserve the action's intent.
 */
function augmentViewHypermedia(world: TWorld, step: TStepperStep, actionResult: TActionResult): TActionResult {
	if (!actionResult.ok || !actionResult.products) return actionResult;
	const productsDomain = step.productsDomain;
	if (!productsDomain) return actionResult;
	const products = actionResult.products as Record<string, unknown>;
	if (typeof products[HYPERMEDIA.COMPONENT] === "string") return actionResult;
	const ui = world.domains[normalizeDomainKey(productsDomain)]?.ui;
	const component = typeof ui?.component === "string" ? ui.component : undefined;
	const rawSummary = ui?.summary;
	let summary: string;
	if (typeof rawSummary === "function") summary = String((rawSummary as (p: Record<string, unknown>) => unknown)(products));
	else if (typeof rawSummary === "string") summary = rawSummary;
	else summary = productsDomain;
	const markers: Record<string, unknown> = {
		[HYPERMEDIA.TYPE]: component ?? productsDomain,
		[HYPERMEDIA.SUMMARY]: summary,
	};
	if (component) {
		markers[HYPERMEDIA.COMPONENT] = component;
		markers.id = productsDomain;
		markers.view = productsDomain;
	}
	return { ...actionResult, products: { ...products, ...markers } };
}

/**
 * A domain that exists only to render a view (its schema is empty, its `ui.component`
 * names the pane to open) carries no knowledge worth chaining on. Asserting such a
 * "fact" creates a loop: each affordances refresh sees the asserted view, includes
 * it in the snapshot, and the SPA re-opens the pane, accumulating duplicates.
 *
 * A domain is view-only iff it declares `ui.component` AND its registered schema
 * has no fields. Real product-bearing domains (DOMAIN_AFFORDANCES, DOMAIN_CHAIN_LINT,
 * domain-key, etc.) carry data even if they ALSO map to a view, and stay assertable.
 */
function isViewOnlyDomain(world: TWorld, domainKey: string): boolean {
	const domain = world.domains[normalizeDomainKey(domainKey)];
	if (!domain?.ui?.component || typeof domain.ui.component !== "string") return false;
	const jsonSchema = z.toJSONSchema(domain.schema) as { properties?: Record<string, unknown>; type?: string };
	if (jsonSchema.type !== "object") return false;
	return !jsonSchema.properties || Object.keys(jsonSchema.properties).length === 0;
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
 * Build a JSON Schema and Zod param schemas for a step's input parameters.
 * Uses z.toJSONSchema() to convert Zod domain schemas into full JSON Schema
 * (enums, object structures, descriptions, etc.) for MCP and SSE consumers.
 * Returns both the JSON Schema (for documentation/discovery) and the Zod schemas (for runtime validation).
 */
function buildInputSchema(stepDef: TStepperStep, world: TWorld): { inputSchema: StepToolInputSchema; paramSchemas: Map<string, z.ZodType>; paramDomainKeys: Map<string, string> } {
	const properties: Record<string, { type?: string; description?: string; [key: string]: unknown }> = {};
	const required: string[] = [];
	const paramSchemas = new Map<string, z.ZodType>();
	const paramDomainKeys = new Map<string, string>();

	if (stepDef.gwta) {
		const { stepValuesMap } = namedInterpolation(stepDef.gwta);
		if (stepValuesMap) {
			for (const v of Object.values(stepValuesMap)) {
				const rawDomain = v.domain || DOMAIN_STRING;
				const parts = rawDomain.split(" | ").sort();
				const domainKey = normalizeDomainKey(parts.join(" | "));
				const domain = world.domains?.[domainKey];

				paramDomainKeys.set(v.term, domainKey);

				if (domain?.schema) {
					paramSchemas.set(v.term, domain.schema);
					try {
						const jsonSchema = z.toJSONSchema(domain.schema) as Record<string, unknown>;
						const prop: Record<string, unknown> = { ...jsonSchema };
						if (domain.description && !prop.description) {
							prop.description = domain.description;
						}
						properties[v.term] = prop;
					} catch {
						properties[v.term] = {
							type: "string",
							description: domain.description,
						};
					}
				} else {
					properties[v.term] = { type: "string" };
				}
				required.push(v.term);
			}
		}
	}

	return {
		inputSchema: { type: "object" as const, properties, required },
		paramSchemas,
		paramDomainKeys,
	};
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

export type DomainDiscoveryInfo = {
	description?: string;
	values?: string[];
	stepperName?: string;
	vertexLabel?: string;
	ui?: Record<string, unknown>;
};

export type StepDiscovery = {
	steps: StepDescriptor[];
	/** Domain definitions from world.domains, serializable for SPA/RPC consumers. */
	domains: Record<string, DomainDiscoveryInfo>;
	/** Hypermedia concern catalog — vertex types with ActivityStreams/JSON-LD metadata. */
	concerns: TConcernCatalog;
};

/**
 * Build a step registry and enrich metadata with input/output schemas.
 * Single entry point for both SSE and MCP transports.
 * Accepts an existing StepRegistry instance to update in-place (for live refresh).
 */
export function discoverSteps(steppers: AStepper[], world: TWorld, stepRegistry?: StepRegistry, options?: { grantedCapability?: string | string[] }): StepDiscovery {
	if (stepRegistry) {
		stepRegistry.refresh(steppers, world);
	}
	const registry = stepRegistry ?? new StepRegistry(steppers, world);
	const all = StepperRegistry.getMetadata(steppers);
	// When a capability context is supplied, drop steps that require a
	// capability the caller wasn't granted. Steps with no capability stay
	// visible to everyone. When no context is supplied, return everything
	// (unchanged behaviour — existing callers keep the full manifest).
	const steps = options?.grantedCapability !== undefined ? all.filter((s) => !s.capability || capabilityAllows(options.grantedCapability, s.capability)) : all;
	for (const step of steps) {
		const tool = registry.get(step.method);
		if (tool) {
			step.inputSchema = tool.inputSchema;
			step.outputSchema = tool.outputSchema;
		}
	}
	const domains: Record<string, DomainDiscoveryInfo> = {};
	for (const [key, domain] of Object.entries(world.domains)) {
		// Prefer explicit values; fall back to extracting enum values from z.enum schemas
		let values = domain.values;
		if (!values && domain.schema) {
			try {
				const jsonSchema = z.toJSONSchema(domain.schema) as Record<string, unknown>;
				if (Array.isArray(jsonSchema.enum)) {
					values = jsonSchema.enum as string[];
				}
			} catch {
				// schema not convertible — leave values undefined
			}
		}
		domains[key] = {
			description: domain.description,
			values,
			stepperName: domain.stepperName,
			vertexLabel: isVertexTopology(domain.topology) ? domain.topology.vertexLabel : undefined,
			ui: domain.ui,
		};
	}
	const concerns = buildConcernCatalog(world.domains);
	return { steps, domains, concerns };
}

/**
 * Emit a SeqPath vertex on step entry so child vertices created during the
 * step can link back to it as a real graph edge. Status and endedAtTime are
 * updated by `emitSeqPathEnd` after the action completes.
 */
async function emitSeqPathStart(world: TWorld, featureStep: TFeatureStep): Promise<void> {
	const store = world.shared.getStore();
	const id = formatSeqPath(featureStep.seqPath);
	// Single upsert with all required fields — partial writes via sequential set() let a concurrent
	// reader (e.g. getClusteredQuads from a polling tick) observe a SeqPath missing its
	// startedAtTime and trip the SeqPathSchema invariant.
	const record: Record<string, unknown> = {
		[SEQ_PATH_FIELD.id]: id,
		[SEQ_PATH_FIELD.stepText]: featureStep.in,
		[SEQ_PATH_FIELD.actionStatus]: SEQ_PATH_STATUS.running,
		[SEQ_PATH_FIELD.startedAtTime]: new Date().toISOString(),
	};
	if (featureStep.source?.path) record[SEQ_PATH_FIELD.path] = featureStep.source.path;
	if (featureStep.seqPath.length > 1) {
		record[LinkRelations.PART_OF.rel] = formatSeqPath(featureStep.seqPath.slice(0, -1));
		const lastIndex = featureStep.seqPath[featureStep.seqPath.length - 1];
		if (lastIndex > 0) {
			record[LinkRelations.PRECEDED_BY.rel] = formatSeqPath([...featureStep.seqPath.slice(0, -1), lastIndex - 1]);
		}
	}
	await store.upsertVertex(SEQ_PATH_LABEL, record);
}

async function emitSeqPathEnd(world: TWorld, featureStep: TFeatureStep, ok: boolean): Promise<void> {
	const store = world.shared.getStore();
	const id = formatSeqPath(featureStep.seqPath);
	const status = ok ? SEQ_PATH_STATUS.passed : SEQ_PATH_STATUS.failed;
	await store.set(id, SEQ_PATH_FIELD.actionStatus, status, SEQ_PATH_LABEL);
	await store.set(id, SEQ_PATH_FIELD.endedAtTime, new Date().toISOString(), SEQ_PATH_LABEL);
}
