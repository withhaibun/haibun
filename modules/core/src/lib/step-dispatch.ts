import { z } from "zod";
import { AStepper } from "./astepper.js";
import type { TWorld, TStepperStep, TFeatureStep } from "./defs.js";
import type {
	TNotOKActionResult,
	TActionOKWithProducts,
	TStepArgs,
	TSeqPath,
} from "../schema/protocol.js";
import { namedInterpolation, mapInputToStepValues } from "./namedVars.js";
import { constructorName } from "./util/index.js";
import { DOMAIN_STRING, normalizeDomainKey } from "./domain-types.js";
import { StepperRegistry, type StepDescriptor } from "./stepper-registry.js";

/** Clean result type for transport consumers (SSE, MCP). Hides haibun internals. */
export type StepHandlerResult =
	| { ok: true; products: Record<string, unknown> }
	| { ok: false; error: string };

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
	handler: (
		input: Record<string, unknown>,
		seqPath?: TSeqPath,
	) => Promise<StepHandlerResult>;
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
	properties?: Record<
		string,
		{ type?: string; description?: string; [key: string]: unknown }
	>;
	required?: string[];
	[key: string]: unknown;
};

/**
 * Build a registry of step tools from the given steppers.
 * Each key is `${stepperName}-${stepName}` (e.g. `MuskegStepper-getTypes`).
 * Steps with `expose: false` are excluded.
 *
 * Used by MCP, SSE, and any future transport.
 */
export function buildStepRegistry(
	steppers: AStepper[],
	world: TWorld,
): Map<string, StepTool> {
	const registry = new Map<string, StepTool>();

	for (const stepper of steppers) {
		const stepperName = constructorName(stepper);

		for (const [stepName, stepDef] of Object.entries(stepper.steps)) {
			if (stepDef.expose === false) continue;

			const { inputSchema, paramSchemas, paramDomainKeys } = buildInputSchema(stepDef, world);
			const name = stepMethodName(stepperName, stepName);
			let outputSchema: Record<string, unknown> | undefined;
			if (stepDef.outputSchema) {
				try {
					outputSchema = z.toJSONSchema(stepDef.outputSchema) as Record<
						string,
						unknown
					>;
				} catch {
					/* skip if schema can't be converted */
				}
			}

			registry.set(name, {
				name,
				description: stepDef.gwta || stepName,
				inputSchema,
				paramSchemas,
				paramDomainKeys,
				outputSchema,
				stepperName,
				stepName,
				handler: createStepHandler(stepperName, stepName, stepDef),
			});
		}
	}

	return registry;
}

/**
 * Validate input against a step tool's Zod schemas, then apply domain.coerce() if available.
 * Returns validated (and coerced) input on success, throws with descriptive errors on failure.
 * Pass world to enable domain coercion (aligns RPC dispatch with feature-file execution).
 */
export function validateToolInput(
	tool: StepTool,
	input: Record<string, unknown>,
	world?: TWorld,
): Record<string, unknown> {
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
				const issues = result.error.issues
					.map((i) =>
						i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message,
					)
					.join("; ");
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
export function stepMethodName(
	stepperOrName: string | AStepper | { name: string },
	stepName: string,
): string {
	const name =
		typeof stepperOrName === "string"
			? stepperOrName
			: "steps" in stepperOrName
				? constructorName(stepperOrName as AStepper)
				: stepperOrName.name;
	return `${name}-${stepName}`;
}

/**
 * Create a handler that calls the step action directly with validated input.
 * RPC transports validate input via validateToolInput() then call this handler.
 * The action receives typed values directly — no string round-tripping through
 * mapInputToStepValues/resolveVariable. A minimal featureStep is provided for provenance.
 */
export function createStepHandler(
	stepperName: string,
	stepName: string,
	stepDef: TStepperStep,
): (
	input: Record<string, unknown>,
	seqPath?: TSeqPath,
) => Promise<StepHandlerResult> {
	return async (
		input: Record<string, unknown>,
		seqPath?: TSeqPath,
	): Promise<StepHandlerResult> => {
		const featureStep: TFeatureStep = {
			in: stepDef.gwta || "",
			action: {
				stepperName,
				actionName: stepName,
				step: stepDef,
				stepValuesMap: mapInputToStepValues(input, stepDef.gwta || ""),
			},
			seqPath: seqPath ?? [0],
			source: { path: "step-dispatch" },
		};

		try {
			const actionResult = await stepDef.action(
				input as TStepArgs,
				featureStep,
			);
			if (actionResult.ok) {
				const products =
					"products" in actionResult
						? (actionResult as TActionOKWithProducts).products
						: {};
				return {
					ok: true,
					products: { ...products, _seqPath: featureStep.seqPath },
				};
			}
			return {
				ok: false,
				error: (actionResult as TNotOKActionResult).message || "Step failed",
			};
		} catch (caught) {
			const err = caught instanceof Error ? caught : new Error(String(caught));
			return { ok: false, error: `${stepperName}-${stepName}: ${err.message}` };
		}
	};
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
	const properties: Record<
		string,
		{ type?: string; description?: string; [key: string]: unknown }
	> = {};
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
						const jsonSchema = z.toJSONSchema(domain.schema) as Record<
							string,
							unknown
						>;
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

export type StepDiscovery = {
	registry: Map<string, StepTool>;
	metadata: StepDescriptor[];
	/** Domain definitions from world.domains, serializable for SPA autocomplete. */
	domains: Record<string, { description?: string; values?: string[] }>;
};

/**
 * Build a step registry and enrich metadata with input/output schemas.
 * Single entry point for both SSE and MCP transports.
 * Accepts an existing StepRegistry instance to update in-place (for live refresh).
 */
export function discoverSteps(
	steppers: AStepper[],
	world: TWorld,
	stepRegistry?: StepRegistry,
): StepDiscovery {
	if (stepRegistry) {
		stepRegistry.refresh(steppers, world);
	}
	const registry = stepRegistry
		? new Map(stepRegistry.list().map((t) => [t.name, t]))
		: buildStepRegistry(steppers, world);
	const metadata = StepperRegistry.getMetadata(steppers);
	for (const meta of metadata) {
		const tool = registry.get(meta.method);
		if (tool) {
			meta.inputSchema = tool.inputSchema;
			meta.outputSchema = tool.outputSchema;
		}
	}
	const domains: Record<string, { description?: string; values?: string[] }> = {};
	for (const [key, domain] of Object.entries(world.domains ?? {})) {
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
		domains[key] = { description: domain.description, values };
	}
	return { registry, metadata, domains };
}
