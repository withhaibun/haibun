/**
 * What actuality declares to a caller: every step, with whether the caller may call it, the domains, the concern catalog, the
 * predicates of the registry, and the steppers of the steps. The declarations are derived once for each version of the
 * registry's steps and set of registered domains.
 */
import { z } from "zod";
import { jsonSchemaFor } from "../../domains/json-schema-of.js";
import { listOf, type TListItem } from "../../domains/lists.js";
import { phraseParts } from "../domains/phrase.js";
import type { TWorld } from "../../actuality/domains/world.js";
import { ConcernCatalogSchema, buildConcernCatalog, counted } from "../../domains/hypermedia.js";
import { HYPERMEDIA } from "../../domains/protocol.js";
import { isPersisted, type TRegisteredDomain } from "../../domains/resources.js";
import { type TDomainDiscoveryInfo, type TStepDefinitions, type TStepDescriptor, type TStepSummaries, type TStepperSummary } from "../domains/step-discovery.js";
import { hostOfMethodName, hostScopedMethodName } from "../domains/step-method.js";
import { StepDefinitionsSchema, StepSummariesSchema, domainSummary, stepDefinition, stepSummary, stepperStepsLink } from "../domains/step-discovery.js";
import { heldPerEntries, recordEntries, sameEntries } from "../derivations/held-per-entries.js";
import type { StepRegistry } from "./step-registry.js";
import { constructorName } from "../../domains/util.js";
import type { AStepper } from "../domains/stepper.js";
import type { TSteppers } from "../domains/steppers.js";
import { mayCall } from "../../domains/actions.js";
import { predicatesOf } from "../derivations/predicate-registry.js";

/** The concern catalog of a set of registered domains, built again only where a domain is added or replaced. */
export const concernCatalogOf = heldPerEntries(recordEntries, (domains: Record<string, TRegisteredDomain>) => buildConcernCatalog(domains));

/** Each stepper that the steps name, in the order the steps name them. Each entry holds the stepper's description, the
 *  number of its steps in `steps` and the link that reads the summaries of its steps. A stepper that another host declares
 *  is named with that host's prefix. steppersOf returns every stepper of actuality when it reads every step of a
 *  registry. stepSummaries and stepDefinitions return this list with the steps. */
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

/** What actuality declares to every caller, apart from whether the caller may call each step: each step, the steppers of the
 *  steps and every domain, as summaries and as definitions, with the concern catalog and the registry's predicates. */
type TDeclarations = {
	steps: TStepDescriptor[];
	steppers: TStepperSummary[];
	summaryDomains: TStepSummaries["domains"];
	definitionDomains: TStepDefinitions["domains"];
	concerns: TStepDefinitions["concerns"];
	predicates: TStepDefinitions["predicates"];
};

/** The declarations of a registry, held for one version of its steps and one set of registered domains. */
const heldDeclarations = new WeakMap<StepRegistry, { version: number; domains: readonly unknown[]; declarations: TDeclarations }>();

/** The entries of the registered domains that the declarations read: each domain, and the component it advertises, which a
 *  stepper sets and withdraws in place as it serves and stops serving the component's assets. */
const declaredDomainEntries = (domains: Readonly<Record<string, TRegisteredDomain>>): readonly unknown[] =>
	Object.entries(domains).flatMap(([key, domain]) => [key, domain, domain.ui]);

/** Returns what actuality declares to every caller. It is derived again where the registry's steps changed since the last
 *  derivation, which emits STEPS_CHANGED, or where a domain was declared, or its component advertised or withdrawn, since. */
function declarationsOf(world: TWorld, registry: StepRegistry): TDeclarations {
	const domains = declaredDomainEntries(world.domains);
	const held = heldDeclarations.get(registry);
	if (held !== undefined && held.version === registry.version && sameEntries(held.domains, domains)) return held.declarations;
	const steps = registry.descriptors();
	const entries = Object.entries(world.domains);
	const { persisted, references } = concernCatalogOf(world.domains);
	const declarations = {
		steps,
		steppers: steppersOf(steps),
		summaryDomains: Object.fromEntries(entries.map(([key, { description }]) => [key, domainSummary(key, description)])),
		definitionDomains: Object.fromEntries(entries.map(([key, domain]) => [key, domainDiscoveryInfo(key, domain)])),
		concerns: { persisted, references },
		// A step another host runs proves that host's predicates.
		predicates: predicatesOf(
			steps.flatMap(({ method, stepperName, stepName }) => {
				const { stepDef } = registry.named(method);
				return stepDef === undefined ? [] : [{ stepperName, actionName: stepName, step: stepDef }];
			}),
		),
	};
	heldDeclarations.set(registry, { version: registry.version, domains, declarations });
	return declarations;
}

/** Whether a caller holding `held` may call each step of the declarations. */
const callableTo = (steps: readonly TStepDescriptor[], held: string | string[] | undefined): boolean[] => steps.map((step) => mayCall(held, step));

/**
 * The summaries of every step actuality declares, each with whether a caller holding `held` may call it, with the steppers
 * of the steps and every domain, as a counted list of steps. A step the caller can't call is listed, so a link to it leads to
 * the action it requires; a caller narrows the list with the list combinators. The registry is actuality's registry, which
 * holds the steps a transport injected.
 */
export function stepSummaries(world: TWorld, registry: StepRegistry, held: string | string[] | undefined): TStepSummaries {
	const { steps, steppers, summaryDomains } = declarationsOf(world, registry);
	const callable = callableTo(steps, held);
	return { steppers, steps: steps.map((step, at) => stepSummary(step, callable[at] === true)), domains: summaryDomains, ...counted(steps.length) };
}

/** The definitions of every step actuality declares, each with whether a caller holding `held` may call it, with the steppers
 *  of the steps, every domain, the concern catalog and the registry's predicates, as a counted list of steps. */
export function stepDefinitions(world: TWorld, registry: StepRegistry, held: string | string[] | undefined): TStepDefinitions {
	const { steps, steppers, definitionDomains, concerns, predicates } = declarationsOf(world, registry);
	const callable = callableTo(steps, held);
	return { steppers, steps: steps.map((step, at) => stepDefinition(step, callable[at] === true)), domains: definitionDomains, concerns, predicates, ...counted(steps.length) };
}

/** The fields of a listed step that name what it names: its method, its pattern, and, at the definition detail, the domain
 *  of each parameter and of its products. */
const NamingStepSchema = z.object({ method: z.string(), pattern: z.string(), paramDomains: z.record(z.string(), z.string()).optional(), productsDomain: z.string().optional() });
const namingSteps = (items: readonly TListItem[]) => items.map((item) => NamingStepSchema.parse(item));
/** The keys of the domains the steps name: each part of its pattern, and the domains its definition states. */
const namedDomains = (items: readonly TListItem[]): Set<string> =>
	new Set(
		namingSteps(items).flatMap(({ pattern, paramDomains, productsDomain }) => [
			...phraseParts(pattern).map(({ domain }) => domain),
			...(paramDomains === undefined ? [] : Object.values(paramDomains)),
			...(productsDomain === undefined ? [] : [productsDomain]),
		]),
	);
/** The entries of a record whose keys are in `kept`. */
const keptEntries = <T>(record: Record<string, T>, kept: ReadonlySet<string>): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([key]) => kept.has(key)));

/** Each stepper of the kept steps, with how many of them it declares. */
const keptSteppers = (items: readonly TListItem[], products: Readonly<Record<string, unknown>>): TStepperSummary[] => {
	const methods = namingSteps(items).map(({ method }) => method);
	return StepSummariesSchema.shape.steppers.parse(products.steppers).flatMap((entry) => {
		const steps = methods.filter((method) => method.startsWith(`${entry.stepper}-`)).length;
		return steps === 0 ? [] : [{ ...entry, steps }];
	});
};
const keptDomains = (items: readonly TListItem[], products: Readonly<Record<string, unknown>>) =>
	keptEntries(z.record(z.string(), z.unknown()).parse(products.domains), namedDomains(items));

/** The list of a read of the step summaries: its steps, with the steppers and the domains they name. */
export const STEP_SUMMARIES_LIST = listOf(StepSummariesSchema, "steps", { narrows: { steppers: keptSteppers, domains: keptDomains } });
/** The list of a read of the step definitions: its steps, with the steppers, the domains, the concerns and the predicates they name. */
export const STEP_DEFINITIONS_LIST = listOf(StepDefinitionsSchema, "steps", {
	narrows: {
		steppers: keptSteppers,
		domains: keptDomains,
		concerns: (items, products) => {
			const named = namedDomains(items);
			const domains = StepDefinitionsSchema.shape.domains.parse(products.domains);
			const { persisted, references } = ConcernCatalogSchema.parse(products.concerns);
			const kept = keptEntries(references, named);
			const types = new Set(
				[...[...named].map((key) => domains[key]?.persistedAs), ...Object.values(kept).map(({ targetPersistedAs }) => targetPersistedAs)].filter((type) => type !== undefined),
			);
			return { persisted: Object.fromEntries(Object.entries(persisted).filter(([type]) => types.has(type))), references: kept };
		},
		predicates: (items, products) => {
			const methods = new Set(namingSteps(items).map(({ method }) => method));
			return StepDefinitionsSchema.shape.predicates.parse(products.predicates).filter(({ method }) => method !== undefined && methods.has(method));
		},
	},
});

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

/** Each stepper, with what it does and each of its steps as its key and its pattern, or its key alone where it doesn't have one: what
 *  the CLI's `--show-steppers` prints. */
export function listedSteppers(steppers: AStepper[]): TSteppers {
	const listed = steppers.map((stepper) => ({
		stepper: constructorName(stepper),
		description: stepper.description,
		// A step without a pattern, such as prose, is listed by its key.
		steps: Object.entries(stepper.steps).map(([key, step]) => {
			const pattern = step.gwta ?? step.exact;
			return pattern === undefined ? key : `${key}: ${pattern}`;
		}),
	}));
	return { steppers: listed, ...counted(listed.length) };
}
