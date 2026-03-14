import { z } from 'zod';
import { AStepper } from './astepper.js';
import type { TWorld, TStepperStep, TFeatureStep } from './defs.js';
import type { TNotOKActionResult, TActionOKWithProducts, TStepArgs } from '../schema/protocol.js';
import { namedInterpolation, mapInputToStepValues } from './namedVars.js';
import { constructorName } from './util/index.js';
import { DOMAIN_STRING, normalizeDomainKey } from './domain-types.js';
import { StepperRegistry, type StepDescriptor } from './stepper-registry.js';

/** Clean result type for transport consumers (SSE, MCP). Hides haibun internals. */
export type StepHandlerResult = { ok: true; products: Record<string, unknown> } | { ok: false; error: string };

/**
 * A registered step tool — the unit of dispatch for any transport (MCP, SSE, etc.).
 */
export type StepTool = {
	name: string;
	description: string;
	inputSchema: StepToolInputSchema;
	/** Zod schemas for each input parameter, keyed by parameter name. Used for runtime validation. */
	paramSchemas: Map<string, z.ZodType>;
	/** JSON Schema describing the products this step returns. Built from outputSchema on step definition. */
	outputSchema?: Record<string, unknown>;
	stepperName: string;
	stepName: string;
	handler: (input: Record<string, unknown>) => Promise<StepHandlerResult>;
};

export type StepToolInputSchema = {
	type: 'object';
	properties?: Record<string, { type?: string; description?: string; [key: string]: unknown }>;
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
export function buildStepRegistry(steppers: AStepper[], world: TWorld): Map<string, StepTool> {
	const registry = new Map<string, StepTool>();

	for (const stepper of steppers) {
		const stepperName = constructorName(stepper);

		for (const [stepName, stepDef] of Object.entries(stepper.steps)) {
			if (stepDef.expose === false) continue;

			const { inputSchema, paramSchemas } = buildInputSchema(stepDef, world);
			const name = stepMethodName(stepperName, stepName);
			let outputSchema: Record<string, unknown> | undefined;
			if (stepDef.outputSchema) {
				try {
					outputSchema = z.toJSONSchema(stepDef.outputSchema) as Record<string, unknown>;
				} catch { /* skip if schema can't be converted */ }
			}

			registry.set(name, {
				name,
				description: stepDef.gwta || stepName,
				inputSchema,
				paramSchemas,
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
 * Validate input against a step tool's Zod schemas.
 * Returns validated (parsed) input on success, throws with descriptive errors on failure.
 */
export function validateToolInput(tool: StepTool, input: Record<string, unknown>): Record<string, unknown> {
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
				validated[key] = result.data;
			} else {
				const issues = result.error.issues.map(i =>
					i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message
				).join('; ');
				errors.push(`"${key}": ${issues}`);
			}
		}
	}

	if (errors.length) {
		throw new Error(`${tool.name} validation failed: ${errors.join(', ')}`);
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
	const name = typeof stepperOrName === 'string'
		? stepperOrName
		: ('steps' in stepperOrName ? constructorName(stepperOrName as AStepper) : stepperOrName.name);
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
): (input: Record<string, unknown>) => Promise<StepHandlerResult> {
	return async (input: Record<string, unknown>): Promise<StepHandlerResult> => {
		const featureStep: TFeatureStep = {
			in: stepDef.gwta || '',
			action: {
				stepperName,
				actionName: stepName,
				step: stepDef,
				stepValuesMap: mapInputToStepValues(input, stepDef.gwta || ''),
			},
			seqPath: [0],
			source: { path: 'step-dispatch' },
		};

		try {
			const actionResult = await stepDef.action(input as TStepArgs, featureStep);
			if (actionResult.ok) {
				const products = 'products' in actionResult ? (actionResult as TActionOKWithProducts).products : {};
				return { ok: true, products: products || {} };
			}
			return { ok: false, error: (actionResult as TNotOKActionResult).message || 'Step failed' };
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
function buildInputSchema(stepDef: TStepperStep, world: TWorld): { inputSchema: StepToolInputSchema; paramSchemas: Map<string, z.ZodType> } {
	const properties: Record<string, { type?: string; description?: string; [key: string]: unknown }> = {};
	const required: string[] = [];
	const paramSchemas = new Map<string, z.ZodType>();

	if (stepDef.gwta) {
		const { stepValuesMap } = namedInterpolation(stepDef.gwta);
		if (stepValuesMap) {
			for (const v of Object.values(stepValuesMap)) {
				const rawDomain = v.domain || DOMAIN_STRING;
				const parts = rawDomain.split(' | ').sort();
				const domainKey = normalizeDomainKey(parts.join(' | '));
				const domain = world.domains?.[domainKey];

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
						properties[v.term] = { type: 'string', description: domain.description };
					}
				} else {
					properties[v.term] = { type: 'string' };
				}
				required.push(v.term);
			}
		}
	}

	return { inputSchema: { type: 'object' as const, properties, required }, paramSchemas };
}

// --- RPC Message Schemas ---

/** Incoming RPC request from client (POST /rpc/:method). */
export const RpcRequestSchema = z.object({
	id: z.string(),
	type: z.literal('rpc'),
	method: z.string(),
	params: z.record(z.string(), z.unknown()).optional().default({}),
	stream: z.boolean().optional(),
});
export type TRpcRequest = z.infer<typeof RpcRequestSchema>;

/** Outgoing RPC response to client (SSE event). */
export const RpcResponseSchema = z.object({
	id: z.string(),
	type: z.literal('rpc-response'),
	result: z.unknown().optional(),
	error: z.string().optional(),
});
export type TRpcResponse = z.infer<typeof RpcResponseSchema>;

/** Outgoing RPC stream chunk to client (SSE event). */
export const RpcStreamSchema = z.object({
	id: z.string(),
	type: z.literal('rpc-stream'),
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
};

/**
 * Build a step registry and enrich metadata with input/output schemas.
 * Single entry point for both SSE and MCP transports.
 */
export function discoverSteps(steppers: AStepper[], world: TWorld): StepDiscovery {
	const registry = buildStepRegistry(steppers, world);
	const metadata = StepperRegistry.getMetadata(steppers);
	for (const meta of metadata) {
		const tool = registry.get(meta.method);
		if (tool) {
			meta.inputSchema = tool.inputSchema;
			meta.outputSchema = tool.outputSchema;
		}
	}
	return { registry, metadata };
}
