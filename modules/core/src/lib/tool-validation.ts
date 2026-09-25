import { z } from "zod";
import type { TStepperStep } from "./astepper.js";
import type { TWorld } from "./world.js";
import { TRACE_SEQ_PATH, type TSeqPath } from "../schema/protocol.js";
import { formatSeqPath } from "./seq-path.js";
import { normalizeDomainKey } from "./domains.js";
import type { StepTool } from "./step-registry.js";
import { errorDetail } from "./util/index.js";

/**
 * Validate input against a step tool's Zod schemas, then apply domain.coerce() if available.
 * Returns validated (and coerced) input on success, throws with descriptive errors on failure.
 * Pass world to enable domain coercion (aligns RPC dispatch with feature-file execution). Each domain's schema takes the
 * forms of its value a feature line may give, so a call may give them too.
 */
export function validateToolInput(fromSeqPath: TSeqPath, tool: StepTool, input: Record<string, unknown>, world?: TWorld): Record<string, unknown> {
	const validated: Record<string, unknown> = { ...input };
	const errors: string[] = [];

	const required = tool.descriptor.inputSchema.required;
	for (const key of required) {
		if (!(key in input) || input[key] === undefined) {
			errors.push(`"${key}": required`);
		}
	}

	for (const [key, value] of Object.entries(input)) {
		const schema = tool.paramSchemas.get(key);
		if (schema) {
			const domainKey = tool.paramDomainKeys.get(key);
			const domain = world && domainKey ? world.domains?.[domainKey] : undefined;
			const coerce = domain?.coerce ? (v: unknown) => domain.coerce?.({ value: v, domain: domainKey || "", term: key, origin: "defined" }) : undefined;
			const result = schema.safeParse(value);
			if (result.success) {
				validated[key] = coerce ? coerce(result.data) : result.data;
			} else {
				errors.push(`"${key}" (value: ${JSON.stringify(value)}): ${errorDetail(result.error)}`);
			}
		}
	}

	if (errors.length) {
		throw new Error(`${tool.descriptor.method} validation failed (caller: [${fromSeqPath.join(".")}]): ${errors.join(", ")}`);
	}

	return validated;
}

/** Whether products were answered by the step of a statement the step at `seqPath` ran, whose dispatch named and validated them. */
const answeredByStatement = (products: object, seqPath: TSeqPath): boolean => {
	const at = (products as Record<string, unknown>)[TRACE_SEQ_PATH];
	return Array.isArray(at) && formatSeqPath(at) !== formatSeqPath(seqPath);
};

/**
 * Validate the products of the step at `seqPath` against the domain it names. A step naming no domain answers with none of
 * its own: products it returns are an error, but for those of a statement it ran.
 */
export function validateProducts(stepperName: string, actionName: string, stepDef: TStepperStep, world: TWorld, products: unknown, seqPath: TSeqPath): string | undefined {
	const schema = resolveOutputSchema(stepperName, actionName, stepDef, world);
	if (!schema) {
		if (products === undefined || products === null || (typeof products === "object" && answeredByStatement(products, seqPath))) return undefined;
		return `step ${stepperName}.${actionName} returned products and names no domain they are`;
	}
	if (products === undefined || products === null) {
		return `step ${stepperName}.${actionName} declared an output schema but action returned no products`;
	}
	const result = schema.safeParse(products);
	if (result.success) return undefined;
	return `step ${stepperName}.${actionName} products failed schema validation: ${result.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`;
}

/**
 * Resolve a step's output schema from the domains it names. At most one of `productsDomain` and `productsDomains` may be
 * set: `productsDomain` uses a registered domain's schema, `productsDomains` builds an object schema keyed by field from
 * each. A step naming neither returns no products.
 */
export function resolveOutputSchema(stepperName: string, stepName: string, stepDef: TStepperStep, world: TWorld): z.ZodType | undefined {
	if (stepDef.productsDomain && stepDef.productsDomains) throw new Error(`step ${stepperName}.${stepName}: only one of productsDomain, productsDomains may be set`);
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
	return undefined;
}
