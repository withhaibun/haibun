import { z } from "zod";
import type { TStepperStep } from "./astepper.js";
import type { TWorld } from "./world.js";
import { Origin, productData, type THypermediaProducts, type TSeqPath, type TStepArgs } from "../schema/protocol.js";
import { normalizeDomainKey, registeredDomain } from "./domains.js";
import type { StepTool } from "./step-registry.js";
import { errorDetail } from "./util/index.js";

/**
 * A call's input as the domain of each parameter takes it: validated by the domain's schema as registered now, then
 * coerced where the domain coerces, as a feature line's value is. Each domain's schema takes the forms of its value a
 * feature line may give, so a call may give them too. Throws naming every parameter refused.
 */
export function validateToolInput(fromSeqPath: TSeqPath, tool: StepTool, input: Record<string, unknown>, world: TWorld): Record<string, unknown> {
	const validated: Record<string, unknown> = { ...input };
	const errors: string[] = [];

	const required = tool.descriptor.inputSchema.required;
	for (const key of required) {
		if (!(key in input) || input[key] === undefined) {
			errors.push(`"${key}": required`);
		}
	}

	for (const [key, value] of Object.entries(input)) {
		const domainKey = tool.paramDomainKeys.get(key);
		if (domainKey === undefined) continue;
		const domain = registeredDomain(world.domains, domainKey, `${tool.descriptor.method}: parameter "${key}"`);
		const result = domain.schema.safeParse(value);
		if (!result.success) {
			errors.push(`"${key}" (value: ${JSON.stringify(value)}): ${errorDetail(result.error)}`);
			continue;
		}
		validated[key] = domain.coerce ? domain.coerce({ value: result.data, domain: domainKey, term: key, origin: Origin.defined }) : result.data;
	}

	if (errors.length) {
		throw new Error(`${tool.descriptor.method} validation failed (caller: [${fromSeqPath.join(".")}]): ${errors.join(", ")}`);
	}

	return validated;
}

/** A statement's step as dispatch ran it: its stepper, its action and the step it ran as. */
const RanStepSchema = z.object({
	action: z.object({
		stepperName: z.string(),
		actionName: z.string(),
		step: z.custom<TStepperStep>((step) => typeof step === "object" && step !== null && "action" in step && typeof step.action === "function"),
	}),
});

/** The step whose domain products are in, and whether it is a statement's step whose products a step passed on. */
type TAnsweringStep = { stepperName: string; actionName: string; step: TStepperStep; passedOn: boolean };

/** The step whose domain a step's products are in: the step itself, or, for one answering with what a statement it ran
 *  answered, that statement's last step as `args` resolved it, since the last step's result is the one passed on. */
function answeringStep(stepperName: string, actionName: string, stepDef: TStepperStep, args: TStepArgs): TAnsweringStep | string {
	if (stepDef.productsOf === undefined) return { stepperName, actionName, step: stepDef, passedOn: false };
	const ran = z.array(RanStepSchema).optional().parse(args[stepDef.productsOf])?.at(-1);
	if (!ran) return `step ${stepperName}.${actionName} answers with what its {${stepDef.productsOf}} answered, and wasn't given a statement there`;
	return { stepperName: ran.action.stepperName, actionName: ran.action.actionName, step: ran.action.step, passedOn: true };
}

/**
 * Validate a step's products against the domain they are in: the one the step names, or, for a step answering with what
 * a statement it ran answered, the one that statement's step names. A step answering with what another such step
 * answered was checked by that step. A step that doesn't name a domain doesn't return products.
 */
export function validateProducts(
	stepperName: string,
	actionName: string,
	stepDef: TStepperStep,
	world: TWorld,
	products: THypermediaProducts | undefined,
	args: TStepArgs,
): string | undefined {
	const answering = answeringStep(stepperName, actionName, stepDef, args);
	if (typeof answering === "string") return answering;
	if (answering.passedOn && answering.step.productsOf !== undefined) return undefined;
	const named = `step ${stepperName}.${actionName}${answering.passedOn ? ` answering as ${answering.stepperName}.${answering.actionName}` : ""}`;
	const schema = resolveOutputSchema(answering.stepperName, answering.actionName, answering.step, world);
	if (!schema) return products === undefined || products === null ? undefined : `${named} returned products and doesn't name a domain for them`;
	if (products === undefined || products === null) return `${named} declared an output schema but its action didn't return products`;
	// What a statement's step answered carries the markers its dispatch added, which aren't part of its domain.
	const result = schema.safeParse(answering.passedOn ? productData(products) : products);
	if (result.success) return undefined;
	return `${named} products failed schema validation: ${result.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`;
}

/**
 * Resolve a step's output schema from the domains it names. At most one of `productsDomain`, `productsDomains` and
 * `productsOf` may be set: `productsDomain` uses a registered domain's schema, `productsDomains` builds an object schema
 * keyed by field from each, and `productsOf` doesn't have one of its own, since each line's statement names it. A step that doesn't name
 * one doesn't return products.
 */
export function resolveOutputSchema(stepperName: string, stepName: string, stepDef: TStepperStep, world: TWorld): z.ZodType | undefined {
	const declared = [stepDef.productsDomain, stepDef.productsDomains, stepDef.productsOf].filter((d) => d !== undefined);
	if (declared.length > 1) throw new Error(`step ${stepperName}.${stepName}: only one of productsDomain, productsDomains, productsOf may be set`);
	if (stepDef.productsDomain) {
		return registeredDomain(world.domains, normalizeDomainKey(stepDef.productsDomain), `step ${stepperName}.${stepName}: productsDomain`).schema;
	}
	if (stepDef.productsDomains) {
		const fields: Record<string, z.ZodType> = {};
		for (const [field, domainKey] of Object.entries(stepDef.productsDomains)) {
			fields[field] = registeredDomain(world.domains, normalizeDomainKey(domainKey), `step ${stepperName}.${stepName}: productsDomains.${field}`).schema;
		}
		return z.object(fields);
	}
	return undefined;
}
