/**
 * A step as a tool every transport reads: its descriptor and the domain of each parameter.
 */
import { jsonSchemaFor } from "../../json-schema-of.js";
import type { AStepper, TStepperStep } from "../domains/stepper.js";
import { DOMAIN_PERSISTED_TYPE } from "../../resources.js";
import { requiredAction } from "../../actions.js";
import { constructorName } from "../../util/index.js";
import { stepMethodName } from "../domains/step-method.js";
import { namedInterpolation } from "./named-vars.js";
import type { TWorld } from "../../actuality/domains/world.js";
import { DOMAIN_DOMAIN_KEY, DOMAIN_RECORD_ID, DOMAIN_STATEMENT, paramDomainKey, registeredDomain } from "../../domains.js";
import type { TInputSchema, TStepDescriptor } from "../domains/step-discovery.js";
import { resolveOutputSchema } from "./tool-validation.js";

/** A step's descriptor and the domain key of each of its parameters, by parameter name. */
export type TStepDeclaration = { descriptor: TStepDescriptor; paramDomainKeys: Map<string, string> };

/** The domains of a parameter that names a record's type. */
const TYPE_NAMING_DOMAINS: readonly string[] = [DOMAIN_PERSISTED_TYPE, DOMAIN_DOMAIN_KEY];

/** The phrase a step's descriptor states: its gwta, its exact text or its match. A prose step and the step of an empty
 *  line don't state a phrase a caller writes, so the descriptor states the step's name. */
const patternOf = (stepName: string, stepDef: TStepperStep): string => {
	if (stepDef.gwta) return stepDef.gwta;
	if (stepDef.exact) return stepDef.exact;
	return stepDef.match === undefined ? stepName : stepDef.match.toString();
};

/** Returns a step's descriptor and the domain key of each of its parameters. Throws where the step names a statement, a
 *  record or a products schema that its phrase and the registered domains don't hold. */
export function stepDeclaration(stepper: AStepper, stepName: string, stepDef: TStepperStep, world: TWorld): TStepDeclaration {
	const stepperName = constructorName(stepper);
	const step = `step ${stepperName}.${stepName}`;
	const { inputSchema, paramDomainKeys } = inputSchemaOf(step, stepDef, world);
	if (stepDef.productsOf !== undefined && paramDomainKeys.get(stepDef.productsOf) !== DOMAIN_STATEMENT)
		throw new Error(`${step}: productsOf names {${stepDef.productsOf}}, which isn't a statement its phrase takes`);
	assertRecordPairings(step, stepDef, paramDomainKeys);
	const outputSchema = resolveOutputSchema(stepperName, stepName, stepDef, world);
	const descriptor: TStepDescriptor = {
		method: stepMethodName(stepperName, stepName),
		stepperName,
		stepperDescription: stepper.description,
		stepName,
		pattern: patternOf(stepName, stepDef),
		description: stepDef.description,
		paramDomains: Object.fromEntries(paramDomainKeys),
		productsDomain: stepDef.productsDomain,
		productsOf: stepDef.productsOf,
		...(stepDef.recordIds ? { recordIds: stepDef.recordIds } : {}),
		...(stepDef.recordData ? { recordData: stepDef.recordData } : {}),
		capability: requiredAction(stepperName, stepName, stepDef),
		...(stepDef.readsAt ? { readsAt: stepDef.readsAt } : {}),
		read: stepDef.read === true,
		fallback: stepDef.fallback === true,
		answersTheTurn: stepDef.answersTheTurn === true,
		...(stepDef.answeredBy ? { answeredBy: stepDef.answeredBy } : {}),
		inputSchema,
		outputSchema: outputSchema === undefined ? undefined : jsonSchemaFor(`${step}: its products schema`, outputSchema, "output"),
	};
	return { descriptor, paramDomainKeys };
}

/** Throws where a parameter `type` pairs doesn't name a record's type. */
function assertNamesAType(step: string, field: string, paired: string, type: string, paramDomainKeys: Map<string, string>): void {
	const domain = paramDomainKeys.get(type);
	if (domain === undefined || !TYPE_NAMING_DOMAINS.includes(domain)) throw new Error(`${step}: ${field} pairs {${paired}} with {${type}}, which doesn't name a type`);
}

/** Throws unless the step's record pairings hold. recordIds pairs each `record-id` parameter with a parameter that names
 *  its record's type. recordData pairs a parameter the phrase takes with a parameter that names its record's type. */
function assertRecordPairings(step: string, stepDef: TStepperStep, paramDomainKeys: Map<string, string>): void {
	const { recordIds, recordData } = stepDef;
	if (recordIds !== undefined)
		for (const [id, type] of Object.entries(recordIds)) {
			if (paramDomainKeys.get(id) !== DOMAIN_RECORD_ID) throw new Error(`${step}: recordIds names {${id}}, which isn't a ${DOMAIN_RECORD_ID} its phrase takes`);
			assertNamesAType(step, "recordIds", id, type, paramDomainKeys);
		}
	for (const [param, domain] of paramDomainKeys)
		if (domain === DOMAIN_RECORD_ID && recordIds?.[param] === undefined)
			throw new Error(`${step}: {${param}} is a ${DOMAIN_RECORD_ID} that its recordIds doesn't pair with a type`);
	if (recordData !== undefined)
		for (const [data, type] of Object.entries(recordData)) {
			if (!paramDomainKeys.has(data)) throw new Error(`${step}: recordData names {${data}}, which its phrase doesn't take`);
			assertNamesAType(step, "recordData", data, type, paramDomainKeys);
		}
}

/**
 * The domain of each parameter that a step's phrase names, as `{name: domain}`. A parameter whose domain the phrase doesn't
 * name takes `string`. A step's schemas, the typed step graph and dispatch all read its input domains through this function.
 */
export function stepParamDomains(stepDef: TStepperStep): Map<string, string> {
	const domains = new Map<string, string>();
	if (!stepDef.gwta) return domains;
	const { stepValuesMap } = namedInterpolation(stepDef.gwta);
	if (stepValuesMap === undefined) return domains;
	for (const v of Object.values(stepValuesMap)) domains.set(v.term, paramDomainKey(v.domain));
	return domains;
}

/**
 * The JSON Schema of a step's input parameters, which discovery, MCP and a page read, and each parameter's domain key.
 * jsonSchemaFor converts each Zod domain schema into a full JSON Schema: its enums, its object structure and its
 * descriptions. Validation reads each domain by its key when a call arrives.
 */
function inputSchemaOf(step: string, stepDef: TStepperStep, world: TWorld): { inputSchema: TInputSchema; paramDomainKeys: Map<string, string> } {
	const properties: TInputSchema["properties"] = {};
	const paramDomainKeys = stepParamDomains(stepDef);
	for (const [term, domainKey] of paramDomainKeys) {
		const domain = registeredDomain(world.domains, domainKey, `${step}: {${term}}`);
		// The schema describes what a caller supplies, so a field the domain fills is optional.
		const jsonSchema = jsonSchemaFor(`${step}: {${term}}'s domain "${domainKey}"`, domain.schema, "input");
		properties[term] = domain.description && !jsonSchema.description ? { ...jsonSchema, description: domain.description } : { ...jsonSchema };
	}
	return { inputSchema: { type: "object" as const, properties, required: [...paramDomainKeys.keys()] }, paramDomainKeys };
}
