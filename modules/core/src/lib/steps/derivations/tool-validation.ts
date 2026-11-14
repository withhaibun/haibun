import { z } from "zod";
import type { AStepper, TFeatureStep, TStepperStep } from "../domains/stepper.js";
import type { TWorld } from "../../actuality/domains/world.js";
import { Origin, productData, type THypermediaProducts, type TSeqPath, type TStepArgs } from "../../domains/protocol.js";
import { normalizeDomainKey, registeredDomain } from "../../domains/domains.js";
import type { TCoercionSite } from "../../domains/resources.js";
import type { StepTool } from "../pipelines/step-registry.js";
import { errorDetail } from "../../domains/util.js";
import { contractProducts } from "../domains/contract.js";

/** The maximum length in characters of a value that a refusal repeats as written. A refusal states the length of a longer
 *  value. A file's bytes are one such value. */
const STATED_VALUE_CHARS = 200;
const statedValue = (value: unknown): string => {
	const written = JSON.stringify(value) ?? String(value);
	return written.length > STATED_VALUE_CHARS ? `${written.length} characters` : written;
};

/**
 * Returns a call's input as the domain of each parameter takes it. Each value is validated by its domain's schema as registered
 * when the call arrives. The domain then coerces the value at the call's seqPath with `steppers`, as it coerces a feature
 * line's value. A call doesn't have a feature, so a statement it gives resolves without a feature's path. Each domain's schema
 * accepts the forms of its value that a feature line may give, so a call may give them too. Throws an error that names every
 * required parameter the input doesn't hold, every key the step's pattern doesn't declare and every refused value, so an
 * action receives only what its pattern declares.
 */
export function validateToolInput(fromSeqPath: TSeqPath, tool: StepTool, input: Record<string, unknown>, world: TWorld, steppers: AStepper[]): Record<string, unknown> {
	const { method, pattern, inputSchema } = tool.descriptor;
	const validated: Record<string, unknown> = {};
	const site: TCoercionSite = { seqPath: fromSeqPath, path: undefined, steppers };
	const errors = inputSchema.required.flatMap((key) => (input[key] === undefined ? [`"${key}": required`] : []));

	for (const [key, value] of Object.entries(input)) {
		if (!(key in inputSchema.properties)) {
			errors.push(`"${key}": the pattern \`${pattern}\` doesn't declare it`);
			continue;
		}
		const domainKey = tool.paramDomainKeys.get(key);
		// A remote host's tool doesn't hold its parameters' domains in this process, so the host validates its values.
		if (domainKey === undefined) {
			validated[key] = value;
			continue;
		}
		const domain = registeredDomain(world.domains, domainKey, `${method}: parameter "${key}"`);
		const result = domain.schema.safeParse(value);
		if (!result.success) {
			errors.push(`"${key}" (value: ${statedValue(value)}): ${errorDetail(result.error)}`);
			continue;
		}
		validated[key] = domain.coerce({ value: result.data, domain: domainKey, term: key, origin: Origin.defined }, site);
	}

	if (errors.length) {
		throw new Error(`${method} validation failed (caller: [${fromSeqPath.join(".")}]): ${errors.join(", ")}`);
	}

	return validated;
}

/** A statement's step as dispatch runs it. It holds the stepper name, the action name and the step definition: one with an
 *  action, or one the logic engine proves by its reading. */
const RanStepSchema = z.object({
	action: z.object({
		stepperName: z.string(),
		actionName: z.string(),
		step: z.custom<TStepperStep>(
			(step) => typeof step === "object" && step !== null && (("action" in step && typeof step.action === "function") || ("reading" in step && typeof step.reading === "string")),
		),
	}),
});
/** The steps of a statement a step's argument holds, as dispatch runs them. */
export const StatementStepsSchema = z.array(
	z.custom<TFeatureStep>((step) => RanStepSchema.safeParse(step).success, "a statement's step states its stepper, its action and its step"),
);

/** The step whose domain holds the products. `passedOn` is true where it is a statement's step whose products another
 *  step returns as its own. */
type TAnsweringStep = { stepperName: string; actionName: string; step: TStepperStep; passedOn: boolean };

/** The step whose domain holds a step's products. That step is the step itself, unless its contract names the statement
 *  whose products it returns. Such a step returns the products of the statement it ran, which the domain of that
 *  statement's last step holds as `args` resolved it, since the last step's result is the one the step returns. Returns an
 *  error message where `args` doesn't hold a statement for that parameter. */
function answeringStep(stepperName: string, actionName: string, stepDef: TStepperStep, args: TStepArgs): TAnsweringStep | string {
	const { of } = contractProducts(stepDef);
	if (of === undefined) return { stepperName, actionName, step: stepDef, passedOn: false };
	// Only the last statement is read, since its result is the one the step returns.
	const ran = StatementStepsSchema.optional().parse(args[of])?.at(-1);
	if (!ran) return `step ${stepperName}.${actionName} passes on the products of {${of}}, which doesn't hold a statement; state a step in it`;
	return { stepperName: ran.action.stepperName, actionName: ran.action.actionName, step: ran.action.step, passedOn: true };
}

/** The field a schema's issue names, or the products themselves where the issue names the whole value. */
const pathSaid = (path: readonly PropertyKey[]): string => (path.length === 0 ? "(root)" : path.map(String).join("."));

/**
 * Validates a step's products against the domain that holds them. That domain is the one the step's contract names. A
 * step that returns its statement's products takes the domain that the statement's last step names. A step that passes on
 * the products of another such step doesn't validate them again, since that step validated them. A step that doesn't name a domain fails
 * validation where it returns products.
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
	if (answering.passedOn && contractProducts(answering.step).of !== undefined) return undefined;
	const named = `step ${stepperName}.${actionName}${answering.passedOn ? ` passing on ${answering.stepperName}.${answering.actionName}` : ""}`;
	const schema = resolveOutputSchema(answering.stepperName, answering.actionName, answering.step, world);
	if (!schema) return products === undefined || products === null ? undefined : `${named} returned products and doesn't name a domain for them`;
	if (products === undefined || products === null) return `${named} declared an output schema but its action didn't return products`;
	// A statement step's products carry the markers its dispatch added. productData removes them, since they aren't part
	// of the domain.
	const result = schema.safeParse(answering.passedOn ? productData(products) : products);
	if (result.success) return undefined;
	return `${named} products failed schema validation: ${result.error.issues.map((i) => `${pathSaid(i.path)} ${i.message}`).join("; ")}`;
}

/**
 * Resolve a step's output schema from the domains its contract names. A domain uses a registered domain's schema. A map
 * of fields builds an object schema with one field for each named domain. A statement's products don't resolve a schema
 * of their own, since each line's statement names its domain. Returns undefined for a step that doesn't name a domain.
 */
export function resolveOutputSchema(stepperName: string, stepName: string, stepDef: TStepperStep, world: TWorld): z.ZodType | undefined {
	const { domain, fields: declared } = contractProducts(stepDef);
	if (domain) return registeredDomain(world.domains, normalizeDomainKey(domain), `step ${stepperName}.${stepName}: contract.products`).schema;
	if (declared) {
		const fields: Record<string, z.ZodType> = {};
		for (const [field, domainKey] of Object.entries(declared)) {
			fields[field] = registeredDomain(world.domains, normalizeDomainKey(domainKey), `step ${stepperName}.${stepName}: contract.products.${field}`).schema;
		}
		return z.object(fields);
	}
	return undefined;
}
