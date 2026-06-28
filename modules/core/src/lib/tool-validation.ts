import { z } from "zod";
import type { TStepperStep } from "./astepper.js";
import type { TWorld } from "./world.js";
import type { TSeqPath } from "../schema/protocol.js";
import { normalizeDomainKey } from "./domains.js";
import type { StepTool } from "./step-registry.js";

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
export function resolveOutputSchema(stepperName: string, stepName: string, stepDef: TStepperStep, world: TWorld): z.ZodType | undefined {
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
