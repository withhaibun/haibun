import { z } from "zod";
import type { TFeatureStep, TStepperStep } from "./astepper.js";
import type { TWorld } from "./world.js";
import { productData, type TSeqPath, type TStepArgs } from "../schema/protocol.js";
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

/** The step whose domain products are in, and whether it is a statement's step whose products a step passed on. */
type TAnsweringStep = { stepperName: string; actionName: string; step: TStepperStep; passedOn: boolean };

/** The step whose domain a step's products are in: the step itself, or, for one answering with what a statement it ran
 *  answered, that statement's last step as `args` resolved it, since the last step's result is the one passed on. */
function answeringStep(stepperName: string, actionName: string, stepDef: TStepperStep, args: TStepArgs): TAnsweringStep | string {
	if (stepDef.productsOf === undefined) return { stepperName, actionName, step: stepDef, passedOn: false };
	const ran = (args[stepDef.productsOf] as unknown as TFeatureStep[] | undefined)?.at(-1);
	if (!ran) return `step ${stepperName}.${actionName} answers with what its {${stepDef.productsOf}} answered, and was given no statement there`;
	return { stepperName: ran.action.stepperName, actionName: ran.action.actionName, step: ran.action.step, passedOn: true };
}

/**
 * Validate a step's products against the domain they are in: the one the step names, or, for a step answering with what
 * a statement it ran answered, the one that statement's step names. A step answering with what another such step
 * answered was checked by that step. A step naming no domain answers with no products.
 */
export function validateProducts(stepperName: string, actionName: string, stepDef: TStepperStep, world: TWorld, products: unknown, args: TStepArgs): string | undefined {
	const answering = answeringStep(stepperName, actionName, stepDef, args);
	if (typeof answering === "string") return answering;
	if (answering.passedOn && answering.step.productsOf !== undefined) return undefined;
	const named = `step ${stepperName}.${actionName}${answering.passedOn ? ` answering as ${answering.stepperName}.${answering.actionName}` : ""}`;
	const schema = resolveOutputSchema(answering.stepperName, answering.actionName, answering.step, world);
	if (!schema) return products === undefined || products === null ? undefined : `${named} returned products and names no domain they are`;
	if (products === undefined || products === null) return `${named} declared an output schema but action returned no products`;
	// What a statement's step answered carries the markers its dispatch added, which are no part of its domain.
	const result = schema.safeParse(answering.passedOn ? productData(products as Record<string, unknown>) : products);
	if (result.success) return undefined;
	return `${named} products failed schema validation: ${result.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`;
}

/**
 * Resolve a step's output schema from the domains it names. At most one of `productsDomain`, `productsDomains` and
 * `productsOf` may be set: `productsDomain` uses a registered domain's schema, `productsDomains` builds an object schema
 * keyed by field from each, and `productsOf` has none of its own, since each line's statement names it. A step naming
 * none returns no products.
 */
export function resolveOutputSchema(stepperName: string, stepName: string, stepDef: TStepperStep, world: TWorld): z.ZodType | undefined {
	const declared = [stepDef.productsDomain, stepDef.productsDomains, stepDef.productsOf].filter((d) => d !== undefined);
	if (declared.length > 1) throw new Error(`step ${stepperName}.${stepName}: only one of productsDomain, productsDomains, productsOf may be set`);
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
