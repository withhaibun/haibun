/**
 * A catalog a test declares: a compact spec of types, their fields by relation, their edges and their declarations, built
 * into the concern catalog a site returns, and declared as the page's step registry, as a read of actuality's steps holds it.
 */
import type { TConcernCatalog, TTitledBy } from "@haibun/core/lib/hypermedia.js";
import type { TDomainDiscoveryInfo } from "@haibun/core/lib/step-discovery.js";
import { Access } from "@haibun/core/lib/resources.js";
import { pageRegistry } from "../page/root.js";
import { stepsShown } from "../test-setup.js";
import { REGISTRY_EVENT, REGISTRY_STATUS, type TStepList } from "../page/machines/registry.js";

type TConcern = TConcernCatalog["persisted"][string];
type TRel = TConcern["properties"][string]["rel"];

/** The relation of an edge whose relation a spec doesn't state. */
const SPEC_EDGE_REL: TRel = "linksTo";

/** A catalog as a test states it: each type, with its fields by relation and its edges by their target types. A
 *  field that both `rels` and `edgeRanges` name is an edge under the relation `rels` names. */
export type TCatalogSpec = {
	types: string[];
	idFields?: Record<string, string>;
	rels?: Record<string, Record<string, string>>;
	edgeRanges?: Record<string, Record<string, string[]>>;
	queryable?: Record<string, string[]>;
	validTimeFields?: Record<string, string>;
	ui?: Record<string, Record<string, unknown>>;
	classIris?: Record<string, string>;
	titledBy?: Record<string, TTitledBy>;
	instrumentationTypes?: string[];
};

/** Returns the concern catalog `spec` states. A type's id field is `id` and its valid time `generatedAtTime` where the spec
 *  doesn't state them. */
export function catalogOf(spec: TCatalogSpec): TConcernCatalog {
	const persisted: Record<string, TConcern> = {};
	for (const label of spec.types) {
		const rels = spec.rels?.[label] ?? {};
		const edgeRanges = spec.edgeRanges?.[label] ?? {};
		const titled = spec.titledBy?.[label];
		persisted[label] = {
			domainKey: label,
			label,
			idField: spec.idFields?.[label] ?? "id",
			asType: spec.classIris?.[label],
			jsonSchema: {},
			// A spec's relations are a test's, which the type doesn't check against the ontology's.
			properties: Object.fromEntries(Object.entries(rels).flatMap(([field, rel]) => (edgeRanges[field] === undefined ? [[field, { term: field, rel: rel as TRel }]] : []))),
			edges: Object.fromEntries(Object.entries(edgeRanges).map(([edge, targets]) => [edge, { term: edge, rel: (rels[edge] ?? SPEC_EDGE_REL) as TRel, targets }])),
			queryable: spec.queryable?.[label] ?? [],
			validTimeField: spec.validTimeFields?.[label] ?? "generatedAtTime",
			displayLabel: titled?.key,
			declared: false,
			instrumentation: spec.instrumentationTypes?.includes(label) === true,
			ui: spec.ui?.[label],
			description: label,
		};
	}
	return { persisted, references: {} };
}

/** Declares `concerns` and `domains` as the page's step registry, read from the site, with the steps the registry holds. */
export function declareCatalog(concerns: TConcernCatalog, domains: Record<string, TDomainDiscoveryInfo> = {}): void {
	const held = pageRegistry().state.get();
	declareRegistry({ steps: held.status === REGISTRY_STATUS.READ ? held.read.list.steps : [], domains, concerns });
}

/** Declares `list` as the page's step registry, read from the site: the steps, the domains and the catalog one read holds. */
export function declareRegistry(list: TStepList): void {
	pageRegistry().dispatch({ type: REGISTRY_EVENT.READ, read: { from: "site", list } });
}

/** Returns the domains of the UI declarations `spec` names under a key that isn't one of its types, as a view a site declares
 *  is a domain without a type. */
export const domainsOf = (spec: TCatalogSpec): Record<string, TDomainDiscoveryInfo> =>
	Object.fromEntries(Object.entries(spec.ui ?? {}).flatMap(([key, ui]) => (spec.types.includes(key) ? [] : [[key, { ui }]])));

/** Declares the catalog `spec` states as the page's step registry. */
export const declareSpec = (spec: TCatalogSpec): void => declareCatalog(catalogOf(spec), domainsOf(spec));

/** The graph source's read steps, as the show steps step describes them to `stepsShown`. */
export const GRAPH_READ_STEPS = (["graphQuery", "density", "getClusteredQuads", "getIndividualWithEdges", "getSelectValues"] as const).map((stepName) => ({
	method: `GraphSourceStepper-${stepName}`,
	stepperName: "GraphSourceStepper",
	stepName,
	pattern: stepName,
	read: true,
	readsAt: Access.public,
}));

/** Declares the catalog `spec` states, with the graph source's reads, as the registry of a page that reads a run. */
export const declareGraphSpec = (spec: TCatalogSpec): void => declareRegistry({ steps: stepsShown(GRAPH_READ_STEPS).steps, domains: domainsOf(spec), concerns: catalogOf(spec) });
