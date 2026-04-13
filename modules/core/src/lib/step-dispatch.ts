import { z } from "zod";
import { AStepper } from "./astepper.js";
import type { TWorld, TStepperStep, TFeatureStep, TStepAction, TBeforeStep, TAfterStep, TAfterStepResult } from "./defs.js";
import { buildConcernCatalog, type TConcernCatalog } from "./hypermedia.js";
import type { TActionResult, TStepResult, TSeqPath } from "../schema/protocol.js";
import { TRACE_SEQ_PATH, Timer, FEATURE_START, SCENARIO_START, DispatchTraceArtifact } from "../schema/protocol.js";
import { namedInterpolation, mapInputToStepValues } from "./namedVars.js";
import { constructorName, actionNotOK } from "./util/index.js";
import { populateActionArgs } from "./populateActionArgs.js";
import { DOMAIN_STRING, normalizeDomainKey } from "./domain-types.js";
import { StepperRegistry, type StepDescriptor } from "./stepper-registry.js";
import { doStepperCycle } from "./stepper-cycles.js";

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
	/** JSON Schema describing the products this step returns. Built from outputSchema on step definition. */
	outputSchema?: Record<string, unknown>;
	stepperName: string;
	stepName: string;
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

	constructor(steppers: AStepper[], world: TWorld) {
		this.refresh(steppers, world);
	}

	/** Rebuild the registry in-place. Safe to call at runtime (live stepper swap). */
	refresh(steppers: AStepper[], world: TWorld): void {
		this.tools = buildStepRegistry(steppers, world);
	}

	get(name: string): StepTool | undefined {
		return this.tools.get(name);
	}

	list(): StepTool[] {
		return Array.from(this.tools.values());
	}

	has(name: string): boolean {
		return this.tools.has(name);
	}

	/** Inject or overwrite a single tool (used by subprocess transport to register child steps). */
	set(tool: StepTool): void {
		this.tools.set(tool.name, tool);
	}
}

export type StepToolInputSchema = {
	type: "object";
	properties?: Record<string, { type?: string; description?: string;[key: string]: unknown }>;
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
	let outputSchema: Record<string, unknown> | undefined;
	if (stepDef.outputSchema) {
		try {
			outputSchema = z.toJSONSchema(stepDef.outputSchema) as Record<string, unknown>;
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
export function validateToolInput(tool: StepTool, input: Record<string, unknown>, world?: TWorld): Record<string, unknown> {
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
				errors.push(`"${key}": ${issues}`);
			}
		}
	}

	if (errors.length) {
		throw new Error(`${tool.name} validation failed: ${errors.join(", ")}`);
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
	const name =
		typeof stepperOrName === "string"
			? stepperOrName
			: "steps" in stepperOrName
				? constructorName(stepperOrName as AStepper)
				: stepperOrName.name;
	return `${name}-${stepName}`;
}

/**
 * Create a handler that populates args from featureStep.action.stepValuesMap,
 * calls stepDef.action, and returns TActionResult.
 *
 * All callers (feature loop, FlowRunner, RPC, MCP, subprocess) use the same signature.
 * External transports build a synthetic featureStep before calling.
 */
export function createStepHandler(stepperName: string, stepName: string, stepDef: TStepperStep,): (featureStep: TFeatureStep, world: TWorld) => Promise<TActionResult> {
	return async (featureStep: TFeatureStep, world: TWorld): Promise<TActionResult> => {
		try {
			const args = await populateActionArgs(featureStep, world, world.runtime.steppers);
			const result = await stepDef.action(args, featureStep);
			if (result.ok && result.products) {
				return { ...result, products: { ...result.products, [TRACE_SEQ_PATH]: featureStep.seqPath } };
			}
			return result;
		} catch (caught) {
			const err = caught instanceof Error ? caught : new Error(String(caught));
			return actionNotOK(`${stepperName}-${stepName}: ${err.message}`);
		}
	};
}

/**
 * Build a synthetic featureStep from raw RPC input params.
 * Used by external transports (SSE, MCP, subprocess) that don't have a real featureStep.
 */
export function buildSyntheticFeatureStep(tool: StepTool, input: Record<string, unknown>, seqPath: TSeqPath): TFeatureStep {
	return {
		in: tool.description,
		action: {
			stepperName: tool.stepperName,
			actionName: tool.stepName,
			step: { gwta: tool.description, action: () => actionNotOK("synthetic step — dispatch through handler") } as TStepperStep,
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

	if (!world.runtime.observations) world.runtime.observations = new Map();
	if (!world.runtime.stepResults) world.runtime.stepResults = [];

	const pushAndReturn = (result: TStepResult): TStepResult => {
		world.runtime.stepResults.push(result);
		return result;
	};

	if (world.runtime.exhaustionError) {
		return pushAndReturn(
			stepResultFromActionResult(
				actionNotOK(`Execution halted: ${world.runtime.exhaustionError}`),
				action,
				start,
				Timer.since(),
				featureStep,
				false,
			),
		);
	}
	if (featureStep.seqPath.length > MAX_DISPATCH_SEQPATH) {
		const msg = `Execution depth limit exceeded (${featureStep.seqPath.length} > ${MAX_DISPATCH_SEQPATH}). Possible infinite recursion in step: ${featureStep.in}`;
		world.runtime.exhaustionError = msg;
		return pushAndReturn(stepResultFromActionResult(actionNotOK(msg), action, start, Timer.since(), featureStep, false));
	}

	const isLifecycle = action.actionName === FEATURE_START || action.actionName === SCENARIO_START;
	if (isLifecycle) {
		return stepResultFromActionResult({ ok: true }, action, start, Timer.since(), featureStep, true);
	}

	const method = stepMethodName(action.stepperName, action.actionName);
	const tool = registry.get(method);
	if (!tool) {
		return pushAndReturn(
			stepResultFromActionResult(
				actionNotOK(`Step not found in registry: ${method}`),
				action,
				start,
				Timer.since(),
				featureStep,
				false,
			),
		);
	}

	authorizeToolCapability(tool, grantedCapability);

	const usageKey = `${action.stepperName}.${action.actionName}`;
	let stepUsage = world.runtime.observations.get("stepUsage") as Map<string, number> | undefined;
	if (!stepUsage) {
		stepUsage = new Map();
		world.runtime.observations.set("stepUsage", stepUsage);
	}
	stepUsage.set(usageKey, (stepUsage.get(usageKey) ?? 0) + 1);

	world.eventLogger.stepStart(featureStep, action.stepperName, action.actionName, {}, featureStep.action.stepValuesMap, tool.isAsync,);
	let actionResult: TActionResult;
	let ok = true;
	let lastStepResult: TStepResult;
	let doAction = true;
	while (doAction) {
		await doStepperCycle(steppers, "beforeStep", <TBeforeStep>{ featureStep });
		actionResult = await tool.handler(featureStep, world);
		if (!actionResult.ok && actionResult.errorMessage && featureStep.intent?.mode !== "speculative") {
			world.eventLogger.log(featureStep, "error", actionResult.errorMessage);
		}
		lastStepResult = stepResultFromActionResult(actionResult, action, start, Timer.since(), featureStep, ok && actionResult.ok);
		world.runtime.stepResults.push(lastStepResult);
		const instructions: TAfterStepResult[] = await doStepperCycle(
			steppers,
			"afterStep",
			<TAfterStep>{ featureStep, actionResult },
			action.actionName,
		);
		doAction = instructions.some((i) => i?.rerunStep);
		if (instructions.some((i) => i?.failed)) {
			ok = false;
		} else if (instructions.some((i) => i?.nextStep)) {
			actionResult = { ...actionResult, ok: true };
		}
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
				capabilityGranted: Array.isArray(grantedCapability)
					? grantedCapability
					: grantedCapability
						? [grantedCapability]
						: undefined,
				authorized: ok || !tool.capability,
				seqPath: featureStep.seqPath,
				durationMs: end - start,
				productKeys: ok && actionResult.products ? Object.keys(actionResult.products).filter((k) => !k.startsWith("_")) : undefined,
			},
		}),
	);

	return lastStepResult;
}

export function stepResultFromActionResult(
	actionResult: TActionResult,
	action: TStepAction,
	start: number,
	end: number,
	featureStep: TFeatureStep,
	ok: boolean,
): TStepResult {
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
 * Build a JSON Schema and Zod param schemas for a step's input parameters.
 * Uses z.toJSONSchema() to convert Zod domain schemas into full JSON Schema
 * (enums, object structures, descriptions, etc.) for MCP and SSE consumers.
 * Returns both the JSON Schema (for documentation/discovery) and the Zod schemas (for runtime validation).
 */
function buildInputSchema(
	stepDef: TStepperStep,
	world: TWorld,
): { inputSchema: StepToolInputSchema; paramSchemas: Map<string, z.ZodType>; paramDomainKeys: Map<string, string> } {
	const properties: Record<string, { type?: string; description?: string;[key: string]: unknown }> = {};
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
export function discoverSteps(steppers: AStepper[], world: TWorld, stepRegistry?: StepRegistry): StepDiscovery {
	if (stepRegistry) {
		stepRegistry.refresh(steppers, world);
	}
	const registry = stepRegistry ?? new StepRegistry(steppers, world);
	const steps = StepperRegistry.getMetadata(steppers);
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
			vertexLabel: domain.meta?.vertexLabel,
		};
	}
	const concerns = buildConcernCatalog(world.domains);
	return { steps, domains, concerns };
}
