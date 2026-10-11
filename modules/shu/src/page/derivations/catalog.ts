/**
 * Every part of actuality's concern catalog a view reads, derived once per catalog (SH27): the types, each type's id field,
 * its fields by relation and their ranges (HM17), its edges and the types each may point at, its queryable fields, its valid
 * time, its title, the component it declares, the instrumentation types, and the actor and role edges by which a view lays
 * out records. A new catalog is a new key, so the page derives it again.
 */
import { LinkRelations, RESOURCE_LABEL, fromActorRels, getPropertyDefinitions, isSubPropertyOf, roleRels, toActorRels } from "@haibun/core/lib/resources.js";
import type { TConcernCatalog, TTitledBy } from "@haibun/core/lib/hypermedia.js";
import type { TDomainDiscoveryInfo } from "@haibun/core/lib/step-discovery.js";
import { ACTION_BAR_ASK_SLOT, ACTION_BAR_CHAT_SLOT, SHU_TAG, isMarkerType } from "../../domains/elements.js";
import { propertyVocabulary } from "../../graph/ontology-projection.js";

/** What a catalog derives from: the concern catalog and the domains actuality declares, as a read of its steps holds them. */
export type TCatalogSource = { concerns: TConcernCatalog; domains: Record<string, TDomainDiscoveryInfo> };

/** What the ontology declares of one relation: its IRI, its range, and how a view shows it. */
export type TPropertyDefinition = {
	iri: string;
	range: "iri" | "literal" | "container";
	label?: string;
	icon?: string;
	subPropertyOf?: string | string[];
	presentation?: "summary" | "body" | "governance";
};

/** The parts of a catalog a view reads. */
export type TCatalog = {
	types: string[];
	idFields: Record<string, string>;
	/** Each type's properties, by the relation each declares. */
	rels: Record<string, Record<string, string>>;
	/** Each type's fields, its properties and its edges, by the relation each declares. */
	fieldRels: Record<string, Record<string, string>>;
	/** Each type's edges, and the target types of each. */
	edgeRanges: Record<string, Record<string, string[]>>;
	/** The types each edge may point at, by the edge's name, from the last type that declares it. */
	edgeTargets: Map<string, string[]>;
	properties: Record<string, string[]>;
	queryable: Record<string, string[]>;
	validTimeFields: Record<string, string>;
	summary: Record<string, string[]>;
	ui: Record<string, Record<string, unknown>>;
	/** The declarations of the components each tag names, by the tag. */
	uiByComponent: Map<string, Record<string, unknown>[]>;
	propertyDefinitions: Record<string, TPropertyDefinition>;
	classIris: Record<string, string>;
	titledBy: Record<string, TTitledBy>;
	instrumentationTypes: Set<string>;
	/** Each edge's relation, by the edge's name. */
	edgeRels: Record<string, string>;
	roleEdgeLabels: readonly string[];
	roleEdgeLabelSet: ReadonlySet<string>;
	fromActorEdgeLabels: ReadonlySet<string>;
	toActorEdgeLabels: ReadonlySet<string>;
	roleNouns: ReadonlyMap<string, string>;
	declaredEdgeLabels: ReadonlyMap<string, string>;
};

const derived = new WeakMap<TCatalogSource, TCatalog>();

/** Returns the parts of `source`'s catalog, derived at the first call for the source. */
export function catalogOf(source: TCatalogSource): TCatalog {
	const held = derived.get(source);
	if (held !== undefined) return held;
	const made = derive(source);
	derived.set(source, made);
	return made;
}

/** The core relations' definitions, by relation, which every catalog reads. */
function propertyDefinitions(): Record<string, TPropertyDefinition> {
	return Object.fromEntries(
		getPropertyDefinitions().map((entry) => [
			entry.id,
			{
				iri: entry.iri,
				range: entry.range,
				label: entry.label,
				icon: entry.icon,
				subPropertyOf: entry.subPropertyOf,
				presentation: entry.presentation,
			} satisfies TPropertyDefinition,
		]),
	);
}

/** Returns the actor edges classified under `upper`, each with its ordering weight: core's relations declared under `upper`,
 *  with their declared role priority, and each concern edge whose relation classifies under `upper`, with its own. */
function actorEdgeWeights(concerns: TConcernCatalog, upper: string, coreRels: ReadonlySet<string>): Map<string, number> {
	const corePriority = new Map(getPropertyDefinitions().map((d) => [d.id, d.rolePriority]));
	const weights = new Map<string, number>();
	for (const rel of coreRels) {
		const priority = corePriority.get(rel);
		weights.set(rel, priority === undefined ? 0 : priority);
	}
	for (const concern of Object.values(concerns.persisted)) {
		for (const [edgeName, edge] of Object.entries(concern.edges)) {
			if (!isSubPropertyOf(edge.rel, upper)) continue;
			const declared = edge.rolePriority === undefined ? 0 : edge.rolePriority;
			const held = weights.get(edgeName);
			weights.set(edgeName, held === undefined ? declared : Math.max(held, declared));
		}
	}
	return weights;
}

function derive({ concerns, domains }: TCatalogSource): TCatalog {
	const catalog: TCatalog = {
		types: [],
		idFields: {},
		rels: {},
		fieldRels: {},
		edgeRanges: {},
		edgeTargets: new Map(),
		properties: {},
		queryable: {},
		validTimeFields: {},
		summary: {},
		ui: {},
		uiByComponent: new Map(),
		propertyDefinitions: propertyDefinitions(),
		classIris: {},
		titledBy: {},
		instrumentationTypes: new Set(),
		edgeRels: {},
		roleEdgeLabels: [],
		roleEdgeLabelSet: new Set(),
		fromActorEdgeLabels: new Set(),
		toActorEdgeLabels: new Set(),
		roleNouns: new Map(),
		declaredEdgeLabels: new Map(),
	};
	const roleNouns = new Map<string, string>();
	const declaredEdgeLabels = new Map<string, string>();
	for (const [label, concern] of Object.entries(concerns.persisted)) {
		catalog.types.push(label);
		if (concern.displayLabel !== undefined) catalog.titledBy[label] = { key: concern.displayLabel, through: concern.edges[concern.displayLabel] !== undefined };
		if (concern.instrumentation) catalog.instrumentationTypes.add(label);
		catalog.idFields[label] = concern.idField;
		if (concern.asType !== undefined) catalog.classIris[label] = concern.asType;
		if (concern.queryable.length > 0) catalog.queryable[label] = concern.queryable;
		catalog.validTimeFields[label] = concern.validTimeField;
		catalog.rels[label] = Object.fromEntries(Object.entries(concern.properties).map(([field, prop]) => [field, prop.rel]));
		catalog.fieldRels[label] = { ...catalog.rels[label], ...Object.fromEntries(Object.entries(concern.edges).map(([edgeName, edge]) => [edgeName, edge.rel])) };
		catalog.properties[label] = Object.keys(concern.properties);
		const summary = Object.entries(concern.properties)
			.filter(([, prop]) => prop.rel === LinkRelations.NAME.rel || prop.rel === LinkRelations.CONTEXT.rel)
			.map(([field]) => field);
		if (summary.length > 0) catalog.summary[label] = summary;
		const edges = Object.entries(concern.edges);
		if (edges.length > 0) catalog.edgeRanges[label] = Object.fromEntries(edges.map(([edgeName, edge]) => [edgeName, edge.targets]));
		for (const [edgeName, edge] of edges) {
			catalog.edgeTargets.set(edgeName, edge.targets);
			catalog.edgeRels[edgeName] = edge.rel;
			if (edge.roleNoun !== undefined && !roleNouns.has(edgeName)) roleNouns.set(edgeName, edge.roleNoun);
			if (edge.label !== undefined && !declaredEdgeLabels.has(edgeName)) declaredEdgeLabels.set(edgeName, edge.label);
		}
		if (concern.ui !== undefined) catalog.ui[label] = concern.ui;
	}
	// A concern that declares both `topology.persistedAs` and a selector arrives in the catalog by its label and among the
	// domains by its selector, so the domains add a component the catalog doesn't name.
	const components = new Set(Object.values(catalog.ui).flatMap((entry) => (typeof entry.component === "string" ? [entry.component] : [])));
	for (const [domainKey, info] of Object.entries(domains)) {
		if (info.ui === undefined || catalog.ui[domainKey] !== undefined) continue;
		const component = typeof info.ui.component === "string" ? info.ui.component : undefined;
		if (component !== undefined && components.has(component)) continue;
		catalog.ui[domainKey] = info.ui;
		if (component !== undefined) components.add(component);
	}
	for (const entry of Object.values(catalog.ui)) {
		if (typeof entry.component !== "string") continue;
		const held = catalog.uiByComponent.get(entry.component);
		catalog.uiByComponent.set(entry.component, held === undefined ? [entry] : [...held, entry]);
	}
	const roleEdgeLabels = [...actorEdgeWeights(concerns, LinkRelations.IN_ROLE_OF.rel, roleRels()).entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([k]) => k);
	return {
		...catalog,
		roleEdgeLabels,
		roleEdgeLabelSet: new Set(roleEdgeLabels),
		fromActorEdgeLabels: new Set(actorEdgeWeights(concerns, LinkRelations.FROM_ACTOR.rel, fromActorRels()).keys()),
		toActorEdgeLabels: new Set(actorEdgeWeights(concerns, LinkRelations.TO_ACTOR.rel, toActorRels()).keys()),
		roleNouns,
		declaredEdgeLabels,
	};
}

/** Returns the range of the relation the field `field` of `label` declares, a property or an edge, from the relation's
 *  property definition, or undefined where the type doesn't declare the field or its relation doesn't have a definition (HM17). */
export function rangeOf(catalog: TCatalog, label: string, field: string): TPropertyDefinition["range"] | undefined {
	const rel = catalog.fieldRels[label]?.[field];
	return rel === undefined ? undefined : catalog.propertyDefinitions[rel]?.range;
}

/** Returns the types an edge may point at from `sourceLabel`, else from the type that declares an edge of that name last, or
 *  undefined where the catalog doesn't declare an edge of that name. */
export function edgeTargetLabels(catalog: TCatalog, edgeType: string, sourceLabel: string | undefined): string[] | undefined {
	const fromSource = sourceLabel === undefined ? undefined : catalog.edgeRanges[sourceLabel]?.[edgeType];
	return fromSource === undefined ? catalog.edgeTargets.get(edgeType) : fromSource;
}

/** Returns the type of the record a field of `label` names, where the type declares the field an edge to one type other than
 *  the generic resource. */
export function edgeRecordType(catalog: TCatalog, label: string, field: string): string | undefined {
	const labels = edgeTargetLabels(catalog, field, label);
	const range = labels?.length === 1 ? labels[0] : undefined;
	return range === RESOURCE_LABEL ? undefined : range;
}

/** Whether a type is one of haibun's own: its class IRI is in haibun's vocabulary, where a standard's or a consumer's isn't. */
export function isSystemSchemaType(catalog: TCatalog, label: string): boolean {
	const iri = catalog.classIris[label];
	return iri !== undefined && propertyVocabulary(iri).source === "haibun";
}

/** The relations in the order a view shows a type's fields, from `LinkRelations`' declaration order. */
const REL_PRIORITY = Object.values(LinkRelations).map((lr) => lr.rel);

/** Returns a type's fields in the order of their relations' priority, then by name, or an empty list for an undeclared type. */
export function propertyOrder(catalog: TCatalog, label: string): string[] {
	const labelRels = catalog.rels[label];
	const props = catalog.properties[label];
	if (labelRels === undefined || props === undefined) return [];
	const byPriority = REL_PRIORITY.flatMap((rel) => props.filter((p) => labelRels[p] === rel));
	return [...byPriority, ...props.filter((p) => !byPriority.includes(p)).sort()];
}

/** Returns the views the catalog declares: each domain whose UI names an element a column can hold. */
export const declaredViews = (catalog: TCatalog): string[] =>
	Object.entries(catalog.ui)
		.filter(([, ui]) => typeof ui.component === "string" && !isMarkerType(ui.component))
		.map(([view]) => view);

/** Returns the element a view is shown in: what its domain declares, else the view's own name, which is an element's. */
export function componentOfView(catalog: TCatalog, view: string): string {
	const component = catalog.ui[view]?.component;
	return typeof component === "string" ? component : view;
}

/** Returns the component a record of `label` opens as, or undefined for the generic view. A declaration with a slot mounts a
 *  panel about the type into the slot, and doesn't name a record's view. */
export function recordComponent(catalog: TCatalog, label: string): string | undefined {
	const ui = catalog.ui[label];
	if (ui === undefined || typeof ui.slot === "string") return undefined;
	return typeof ui.component === "string" ? ui.component : undefined;
}

/** The component a product renders in, and the slot its type's UI names, where it names one. */
export type TResolvedUi = { component: string; slot: string | undefined };

/** Returns the component a product renders in: the `_component` its type's domain stamped, else the component its type
 *  declares, else the thread column for a collection (a product that carries `items`) and the entity column for a single
 *  record. Each product resolves to one component. */
export function resolveUi(catalog: TCatalog, product: Record<string, unknown>): TResolvedUi {
	const type = typeof product._type === "string" ? product._type : undefined;
	const ui = type === undefined ? undefined : catalog.ui[type];
	const declared = typeof product._component === "string" ? product._component : type === undefined ? undefined : recordComponent(catalog, type);
	const isCollection = Array.isArray(product.items) && product.items.length > 0;
	const component = declared !== undefined ? declared : isCollection ? SHU_TAG.THREAD_COLUMN : SHU_TAG.ENTITY_COLUMN;
	return { component, slot: typeof ui?.slot === "string" ? ui.slot : undefined };
}

/** Returns the type whose records open in `component`, as the type's declaration names it. Throws where the catalog
 *  doesn't declare one type that way. */
export function typeShownIn(catalog: TCatalog, component: string): string {
	const types = catalog.types.filter((label) => recordComponent(catalog, label) === component);
	if (types.length !== 1) throw new Error(`the catalog declares ${types.length} types whose records open in <${component}> (${types.join(", ")}), where a view reads one`);
	return types[0] as string;
}

/** Returns the declaration of the component `component` names, or undefined where the catalog doesn't declare it. Throws
 *  where more than one concern declares it. */
export function uiOfComponent(catalog: TCatalog, component: string): Record<string, unknown> | undefined {
	const matches = catalog.uiByComponent.get(component);
	if (matches === undefined) return undefined;
	if (matches.length > 1) throw new Error(`${matches.length} concerns declare the UI extension of component ${component}`);
	return matches[0];
}

/** Returns the concern that presents `kind` (`ui.presents`), such as the site's graph view, or undefined where a concern doesn't present it. */
export function uiPresenting(catalog: TCatalog, kind: string): { type: string; ui: Record<string, unknown> } | undefined {
	const found = Object.entries(catalog.ui).find(([, ui]) => ui.presents === kind);
	return found === undefined ? undefined : { type: found[0], ui: found[1] };
}

/** Returns the tags of the elements the concerns mount in `slot`. */
export const uiExtensionTags = (catalog: TCatalog, slot: string): string[] =>
	Object.values(catalog.ui)
		.filter((ui) => ui.slot === slot && typeof ui.component === "string")
		.map((ui) => String(ui.component));

/** The slots of the actions bar: its input line in every mode, and the ask's own row. */
export const ACTION_BAR_SLOTS = { chat: ACTION_BAR_CHAT_SLOT, ask: ACTION_BAR_ASK_SLOT } as const;

/** Returns the fields a type offers as dropdowns: those it declares as context. A type the catalog doesn't declare doesn't
 *  offer one. */
export function selectFields(catalog: TCatalog, label: string): string[] {
	const rels = catalog.rels[label];
	if (rels === undefined) return [];
	return Object.entries(rels)
		.filter(([, rel]) => rel === LinkRelations.CONTEXT.rel)
		.map(([property]) => property)
		.sort();
}

/** Returns the types the actor edges of `sourceTypes` point at: whom an exchange between them is with, from the declared
 *  ranges, since a type a reading leaves out isn't read and its edges aren't there to read. */
export function actorTypesFor(catalog: TCatalog, sourceTypes: Iterable<string>): string[] {
	const actorEdges = new Set([...catalog.fromActorEdgeLabels, ...catalog.toActorEdgeLabels]);
	const types = new Set<string>();
	for (const source of sourceTypes) {
		const ranges = catalog.edgeRanges[source];
		if (ranges === undefined) continue;
		for (const [edge, targets] of Object.entries(ranges)) if (actorEdges.has(edge)) for (const target of targets) types.add(target);
	}
	return [...types];
}
