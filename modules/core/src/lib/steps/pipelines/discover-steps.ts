/**
 * What actuality declares to a caller: the steps a caller may call, the domains, the concern catalog, and the steppers of
 * the steps that matched. The catalog is built once for each set of registered domains.
 */
import { jsonSchemaFor } from "../../domains/json-schema-of.js";
import type { TWorld } from "../../actuality/domains/world.js";
import { buildConcernCatalog } from "../../domains/hypermedia.js";
import { HYPERMEDIA } from "../../domains/protocol.js";
import { isPersisted, type TRegisteredDomain } from "../../domains/resources.js";
import {
	STEP_DETAIL,
	type TDomainDiscoveryInfo,
	type TStepDefinitions,
	type TStepDescriptor,
	type TStepSummaries,
	type TStepperSummary,
	type TStepsQuery,
} from "../domains/step-discovery.js";
import { hostOfMethodName, hostScopedMethodName } from "../domains/step-method.js";
import { containsText, domainSummary, stepDefinition, stepSummary, stepperStepsLink } from "../domains/step-discovery.js";
import { heldPerEntries, recordEntries } from "../derivations/held-per-entries.js";
import type { StepRegistry } from "./step-registry.js";

/** The concern catalog of a set of registered domains, built again only where a domain is added or replaced. */
export const concernCatalogOf = heldPerEntries(recordEntries, (domains: Record<string, TRegisteredDomain>) => buildConcernCatalog(domains));

/** Each stepper that the steps name, in the order the steps name them. Each entry holds the stepper's description, the
 *  number of its steps in `steps` and the link that reads the summaries of its steps. A stepper that another host declares
 *  is named with that host's prefix. steppersOf returns every stepper of actuality when it reads every step of a
 *  registry. discoverSteps returns this list with the steps that matched. */
export function steppersOf(steps: TStepDescriptor[]): TStepperSummary[] {
	const byStepper = new Map<string, TStepperSummary>();
	for (const step of steps) {
		const host = hostOfMethodName(step.method);
		const stepper = host === undefined ? step.stepperName : hostScopedMethodName(host, step.stepperName);
		const entry = byStepper.get(stepper);
		if (entry) entry.steps += 1;
		else byStepper.set(stepper, { stepper, description: step.stepperDescription, steps: 1, [HYPERMEDIA.LINKS]: { steps: stepperStepsLink(stepper) } });
	}
	return [...byStepper.values()];
}

/**
 * What actuality declares to a caller. The result holds each step and each domain whose text contains the query's text,
 * compared without regard to case. It also holds the steppers of the matched steps. A step's texts are its method, its
 * pattern and its description, so a stepper's name and a hyphen match that stepper's steps. A domain's texts are its
 * name and its description.
 *
 * A step is shown only to a caller that holds the action it requires, so a caller isn't shown a step it may not call.
 * Every matching domain is shown whatever the caller holds, since a record can't be read without the declaration of its
 * type. The registry is actuality's registry, which holds the steps a transport injected.
 */
export function discoverSteps(
	world: TWorld,
	registry: StepRegistry,
	query: TStepsQuery & { detail: typeof STEP_DETAIL.summary },
	held: string | string[] | undefined,
): TStepSummaries;
export function discoverSteps(
	world: TWorld,
	registry: StepRegistry,
	query: TStepsQuery & { detail: typeof STEP_DETAIL.definition },
	held: string | string[] | undefined,
): TStepDefinitions;
export function discoverSteps(world: TWorld, registry: StepRegistry, query: TStepsQuery, held: string | string[] | undefined): TStepSummaries | TStepDefinitions;
export function discoverSteps(world: TWorld, registry: StepRegistry, query: TStepsQuery, held: string | string[] | undefined): TStepSummaries | TStepDefinitions {
	const steps = registry.heldBy(held).filter((step) => containsText([step.method, step.pattern, step.description], query.text));
	const steppers = steppersOf(steps);
	const domains = Object.entries(world.domains).filter(([key, domain]) => containsText([key, domain.description], query.text));
	if (query.detail === STEP_DETAIL.summary) {
		return {
			detail: STEP_DETAIL.summary,
			steppers,
			steps: steps.map(stepSummary),
			domains: Object.fromEntries(domains.map(([key, { description }]) => [key, domainSummary(key, description)])),
		};
	}
	const catalog = concernCatalogOf(world.domains);
	return {
		detail: STEP_DETAIL.definition,
		steppers,
		steps: steps.map(stepDefinition),
		domains: Object.fromEntries(domains.map(([key, domain]) => [key, domainDiscoveryInfo(key, domain)])),
		concerns: {
			persisted: Object.fromEntries(Object.entries(catalog.persisted).filter(([label, concern]) => containsText([label, concern.description], query.text))),
			references: Object.fromEntries(Object.entries(catalog.references).filter(([key, reference]) => containsText([key, reference.targetDomain], query.text))),
		},
	};
}

/** The values a domain lists: its declared values, or the enum its schema states. A domain of open values doesn't list values. */
function valuesOf(key: string, domain: TRegisteredDomain): string[] | undefined {
	if (domain.values !== undefined) return domain.values;
	const enumerated = jsonSchemaFor(`domain "${key}"`, domain.schema, "input").enum;
	return Array.isArray(enumerated) ? enumerated.map(String) : undefined;
}

/** A registered domain as a read of actuality's declarations states it. It holds the domain's enum values where its schema
 *  states them. It holds the domain's ui without the component's source. A client loads the source from the URL the
 *  domain names. */
function domainDiscoveryInfo(key: string, domain: TRegisteredDomain): TDomainDiscoveryInfo {
	const ui = domain.ui ? (({ jsContent: _source, ...rest }) => rest)(domain.ui) : undefined;
	return {
		description: domain.description,
		values: valuesOf(key, domain),
		stepperName: domain.stepperName,
		persistedAs: isPersisted(domain.topology) ? domain.topology.persistedAs : undefined,
		ui,
	};
}
