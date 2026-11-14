/**
 * A step as a tool every transport reads: its descriptor and the domain of each parameter, which the predicate registry's parts
 * of the step state.
 */
import { DomainKeySchema } from "../../domains/domains.js";
import { jsonSchemaFor } from "../../domains/json-schema-of.js";
import type { AStepper, TStepperStep } from "../domains/stepper.js";
import { DOMAIN_PERSISTED_TYPE } from "../../domains/resources.js";
import { requiredAction } from "../../domains/actions.js";
import { constructorName } from "../../domains/util.js";
import { stepMethodName } from "../domains/step-method.js";
import { requiredNames, stepParts } from "../domains/phrase.js";
import type { TWorld } from "../../actuality/domains/world.js";
import { DOMAIN_DOMAIN_KEY, DOMAIN_RECORD_ID, DOMAIN_STATEMENT, registeredDomain } from "../../domains/domains.js";
import type { TInputSchema, TStepDescriptor } from "../domains/step-discovery.js";
import { resolveOutputSchema } from "./tool-validation.js";
import { CONTRACT_CHECK, contractProducts, StepContractSchema, type TContractSentences, type TStepContract } from "../domains/contract.js";
import { statementSentence } from "./predicate-registry.js";

/** A contract as a descriptor carries it: whether it is a read, whether its products are assumed, its products, and the sentence
 *  of each statement it requires and states. */
function contractSentences({ products, ...contract }: TStepContract): TContractSentences {
	const sentences = Object.values(CONTRACT_CHECK).flatMap((check) => {
		const statements = contract[check];
		return statements === undefined || statements.length === 0 ? [] : [[check, statements.map(statementSentence)]];
	});
	return StepContractSchema.parse({ ...(contract.read ? { read: true } : {}), ...(contract.assumed ? { assumed: true } : {}), products, ...Object.fromEntries(sentences) });
}

/** A step's descriptor and the domain key of each of its parameters, by parameter name. */
export type TStepDeclaration = { descriptor: TStepDescriptor; paramDomainKeys: Map<string, string> };

/** The domains of a parameter that names a record's type. */
const TYPE_NAMING_DOMAINS: readonly string[] = [DOMAIN_PERSISTED_TYPE, DOMAIN_DOMAIN_KEY];

/** The phrase a step's descriptor states: its gwta or its exact text. A prose step and the step of an empty line don't
 *  state a phrase a caller writes, so the descriptor states the step's name. */
const patternOf = (stepName: string, stepDef: TStepperStep): string => {
	if (stepDef.gwta) return stepDef.gwta;
	if (stepDef.exact) return stepDef.exact;
	return stepName;
};

/** Returns a step's descriptor and the domain key of each of its parameters. Throws where the step names a statement, a
 *  record or a products schema that its phrase and the registered domains don't hold. */
export function stepDeclaration(stepper: AStepper, stepName: string, stepDef: TStepperStep, world: TWorld): TStepDeclaration {
	const stepperName = constructorName(stepper);
	const step = `step ${stepperName}.${stepName}`;
	const { inputSchema, paramDomainKeys } = inputSchemaOf(step, stepDef, world);
	const { of } = contractProducts(stepDef);
	if (of !== undefined && paramDomainKeys.get(of) !== DOMAIN_STATEMENT) throw new Error(`${step}: contract.products.of names {${of}}, which isn't a statement its phrase takes`);
	if (stepDef.transformsList !== undefined && of === undefined)
		throw new Error(`${step}: transformsList makes something of its statement's list, so state the statement in contract.products.of`);
	assertRecordPairings(step, stepDef, paramDomainKeys);
	if (stepDef.description.trim() === "") throw new Error(`${step} has an empty description. State what the step does in its description.`);
	const outputSchema = resolveOutputSchema(stepperName, stepName, stepDef, world);
	const descriptor: TStepDescriptor = {
		method: stepMethodName(stepperName, stepName),
		stepperName,
		stepperDescription: stepper.description,
		stepName,
		pattern: patternOf(stepName, stepDef),
		description: stepDef.description,
		paramDomains: Object.fromEntries([...paramDomainKeys].map(([name, key]) => [name, DomainKeySchema.parse(key)])),
		...(stepDef.contract === undefined ? {} : { contract: contractSentences(stepDef.contract) }),
		...(stepDef.recordIds ? { recordIds: stepDef.recordIds } : {}),
		...(stepDef.recordData ? { recordData: stepDef.recordData } : {}),
		capability: requiredAction(stepperName, stepName, stepDef),
		...(stepDef.readsAt ? { readsAt: stepDef.readsAt } : {}),
		...(stepDef.writesAt ? { writesAt: stepDef.writesAt } : {}),
		kaname: stepDef.kaname === true,
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
 * The JSON Schema of a step's input parameters, which discovery, MCP and a page read, and each parameter's domain key.
 * jsonSchemaFor converts each Zod domain schema into a full JSON Schema: its enums, its object structure and its
 * descriptions. Validation reads each domain by its key when a call arrives. A parameter inside an optional group of the
 * pattern isn't required, since a line may leave the group out.
 */
function inputSchemaOf(step: string, stepDef: TStepperStep, world: TWorld): { inputSchema: TInputSchema; paramDomainKeys: Map<string, string> } {
	const properties: TInputSchema["properties"] = {};
	const parts = stepParts(stepDef);
	const paramDomainKeys = new Map(parts.map(({ name, domain }) => [name, domain]));
	for (const [term, domainKey] of paramDomainKeys) {
		const domain = registeredDomain(world.domains, domainKey, `${step}: {${term}}`);
		// The schema describes what a caller supplies, so a field the domain fills is optional.
		const jsonSchema = jsonSchemaFor(`${step}: {${term}}'s domain "${domainKey}"`, domain.schema, "input");
		properties[term] = domain.description && !jsonSchema.description ? { ...jsonSchema, description: domain.description } : { ...jsonSchema };
	}
	return { inputSchema: { type: "object" as const, properties, required: requiredNames(parts) }, paramDomainKeys };
}
