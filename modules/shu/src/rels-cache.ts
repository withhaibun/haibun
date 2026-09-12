/**
 * Schema metadata cache, populated once from getSiteMetadata RPC call.
 * Provides rels, edge ranges, and properties for all node types.
 */
import { propertyVocabulary } from "./graph/ontology-projection.js";
import { ACTION_BAR_ASK_SLOT, ACTION_BAR_CHAT_SLOT, isMarkerType } from "./consts.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

/**
 * Per-rel runtime metadata: the Property node projection.
 * Keyed by rel name (e.g. "hasBody"), one entry per RDF Property.
 *   iri: RDFS URI for the rel (rdfs:Property's @id).
 *   range: RDF range: "iri" | "literal" | "container".
 *   label: display name for renderers (rdfs:label).
 *   icon: visual badge for the rel.
 *   subPropertyOf: parent rel (rdfs:subPropertyOf) for ancestry walks.
 *   presentation: rendering bucket: "summary" | "body" | "governance".
 */
export interface PropertyDefinition {
	iri: string;
	range: "iri" | "literal" | "container";
	label?: string;
	icon?: string;
	subPropertyOf?: string | string[];
	presentation?: "summary" | "body" | "governance";
}

export interface SiteMetadata {
	types: string[];
	idFields: Record<string, string>;
	rels: Record<string, Record<string, string>>;
	edgeRanges: Record<string, Record<string, string>>;
	properties: Record<string, string[]>;
	/** Fields the server accepts as query filters (the topology's sortColumns), per label. */
	queryable: Record<string, string[]>;
	/** Per label, the field carrying the type's valid time (the catalog's validTimeField, where the term is defined). */
	validTimeFields: Record<string, string>;
	summary: Record<string, string[]>;
	ui: Record<string, Record<string, unknown>>;
	/** Per-rel metadata (label, icon, subPropertyOf, presentation, range, iri). */
	propertyDefinitions: Record<string, PropertyDefinition>;
	/** Per label, the type's class IRI (topology.type / the concern's asType), when it declares one, lets a view tell a
	 *  haibun-namespace (system) type from a standard/consumer one. The builder always sets it; optional for partial fixtures. */
	classIris?: Record<string, string>;
	/** Per label, the property type (rel) whose value titles it, `topology.displayLabel`, where declared. */
	displayLabelRels?: Record<string, string>;
}

let metadata: SiteMetadata | null = null;
const edgeTypeIndex = new Map<string, string>();
const metadataReadyResolvers: Array<(m: SiteMetadata) => void> = [];

/** Populate the cache from a getSiteMetadata response. Called once at startup. */
export function setSiteMetadata(data: SiteMetadata): void {
	metadata = data;
	edgeTypeIndex.clear();
	for (const ranges of Object.values(data.edgeRanges)) {
		for (const [edge, target] of Object.entries(ranges)) {
			edgeTypeIndex.set(edge, target);
		}
	}
	const resolvers = metadataReadyResolvers.splice(0);
	for (const resolve of resolvers) resolve(data);
}

/**
 * Resolve once site metadata is populated. Components that depend on the
 * concern catalog (e.g. UI-extension loading in the actions bar) await this
 * before reading `getSiteMetadataSync`, avoiding the init-order race where
 * `connectedCallback` runs before `setConcernCatalog`.
 */
export function whenSiteMetadataReady(): Promise<SiteMetadata> {
	if (metadata) return Promise.resolve(metadata);
	return new Promise<SiteMetadata>((resolve) => {
		metadataReadyResolvers.push(resolve);
	});
}

/** Get cached rels for a label. Returns undefined if metadata not initialized or label unknown. */
export function getRels(label: string): Record<string, string> | undefined {
	return metadata?.rels[label];
}

/** Every persisted type label the site declares: the whole schema vocabulary. Empty until metadata lands. */
export function getTypes(): string[] {
	return metadata?.types ?? [];
}

/** The concern whose ui declares it PRESENTS a capability (ui.presents, e.g. "graph" for the site's graph view), so a
 *  view can embed the site's presenter for that capability without naming any concrete component. */
export function getUiPresenting(kind: string): { type: string; ui: Record<string, unknown> } | undefined {
	for (const [type, ui] of Object.entries(metadata?.ui ?? {})) if (ui.presents === kind) return { type, ui };
	return undefined;
}

/** Sync lookup, returns cached rel for a property. */
export function getRelSync(label: string, property: string): string | undefined {
	return metadata?.rels[label]?.[property];
}

/** Whether a type is a SYSTEM schema: its class IRI is haibun's own vocabulary (a haibun-namespace prefix), as opposed
 *  to a standard's (prov:/sosa:/…) or a consumer's coined one. A consumer-standard type is not a system schema; a
 *  haibun-defined type (e.g. hbn:SeqPath) is. False when the type declares no class IRI. */
export function isSystemSchemaType(label: string): boolean {
	const iri = metadata?.classIris?.[label];
	return iri !== undefined && propertyVocabulary(iri).source === "haibun";
}

/** The property type (rel) whose value titles this type, where its vocabulary designates one (`topology.displayLabel`). */
export function getDisplayLabelRel(label: string): string | undefined {
	return metadata?.displayLabelRels?.[label];
}

/** What the site declares about one property type: its IRI, range, and how to show it (label, icon). Undefined for a name the ontology does not declare. */
export function getPropertyDefinition(rel: string): PropertyDefinition | undefined {
	return metadata?.propertyDefinitions?.[rel];
}

/** Get cached edge ranges for a label. */
export function getEdgeRanges(label: string): Record<string, string> | undefined {
	return metadata?.edgeRanges[label];
}

/** Sync lookup, returns target label for an edge type from a source node label. Falls back to global index. */
export function getEdgeTargetLabel(edgeType: string, sourceLabel?: string): string | undefined {
	if (sourceLabel) {
		const target = metadata?.edgeRanges[sourceLabel]?.[edgeType];
		if (target) return target;
	}
	return edgeTypeIndex.get(edgeType);
}

/** Get cached properties for a label. */
export function getProperties(label: string): string[] | undefined {
	return metadata?.properties[label];
}

/** Get the identifier field name for a label (the `@id` / idField of its concern). */
export function getIdField(label: string): string | undefined {
	return metadata?.idFields[label];
}

/** Get the fields a label accepts as query filters (the topology's sortColumns). The idField is never among them. */
export function getQueryableFields(label: string): string[] {
	return metadata?.queryable[label] ?? [];
}

/** The field carrying a label's valid time, from the catalog's validTimeField; generatedAtTime when the label is unknown. */
export function getValidTimeField(label: string): string {
	return metadata?.validTimeFields[label] ?? LinkRelations.GENERATED_AT_TIME.rel;
}

/** Get cached summary fields for a label. */
export function getSummaryFields(label: string): Set<string> {
	return new Set(metadata?.summary[label]);
}

/** Rel-based property display priority. Derived from LinkRelations declaration order. */
const REL_PRIORITY = Object.values(LinkRelations).map((lr) => lr.rel);

/** Get properties for a label ordered by their rel's semantic priority, then alphabetically. */
export function getPropertyOrder(label: string): string[] {
	const labelRels = getRels(label);
	const props = getProperties(label);
	if (!labelRels || !props) return [];
	if (!Object.keys(labelRels).length) return props;
	const byPriority = REL_PRIORITY.flatMap((rel) => props.filter((p) => labelRels[p] === rel));
	const rest = props.filter((p) => !byPriority.includes(p)).sort();
	return [...byPriority, ...rest];
}

/** Get the UI extension declared by a type's domain (if any). Used by the actions bar / SPA chrome to discover custom components. */
export function getUiByType(label: string): Record<string, unknown> | undefined {
	return metadata?.ui?.[label];
}

/** The views the site declares: every domain whose ui names an element a column can hold. A step's record names the
 *  view it showed by this name, so this is what a page asks the run's records for. */
export function declaredViews(): string[] {
	return Object.entries(metadata?.ui ?? {})
		.filter(([, ui]) => typeof ui.component === "string" && !isMarkerType(ui.component))
		.map(([view]) => view);
}

/** The element a view is shown in: what its domain declares, else the view's own name, which is an element's. */
export function componentOfView(view: string): string {
	const component = getUiByType(view)?.component;
	return typeof component === "string" ? component : view;
}

/**
 * The component a RECORD of this type opens or renders as, or undefined for the generic view.
 *
 * A declaration carrying a `slot` mounts a panel into that slot: the petitions panel sits in the permissions area
 * for every proposal there is, and is about the type rather than about one record of it. Such a panel has none of a
 * record view's methods, so opening a record with it fails at the first call it receives. Only a slotless
 * declaration names a type's own view.
 */
export function getRecordComponent(label: string): string | undefined {
	const ui = getUiByType(label);
	if (!ui || typeof ui.slot === "string") return undefined;
	return typeof ui.component === "string" ? ui.component : undefined;
}

/** Resolve a UI extension by component tag name from concern-derived metadata. */
export function getUiByComponent(component: string): Record<string, unknown> | undefined {
	if (!metadata) return undefined;
	const matches = Object.values(metadata.ui).filter((ui) => ui?.component === component);
	if (matches.length === 0) return undefined;
	if (matches.length > 1) throw new Error(`Ambiguous UI extension for component ${component}: ${matches.length} concern entries`);
	return matches[0];
}

const selectCache = new Map<string, Record<string, string[]>>();

/** Set cached select values for a label (from getSelectValues RPC). */
export function setSelectValues(label: string, values: Record<string, string[]>): void {
	selectCache.set(label, values);
}

/** The fields a label offers as dropdowns: those its type declares as context. The site reads the same declaration to
 *  answer with their values, so a page deriving them from the graph it holds offers the same fields. */
export function getSelectFields(label: string): string[] {
	return Object.entries(getRels(label) ?? {})
		.filter(([, rel]) => rel === LinkRelations.CONTEXT.rel)
		.map(([property]) => property)
		.sort();
}

/** Get cached select (dropdown) field values for a label. */
export function getSelectValues(label: string): Record<string, string[]> {
	return selectCache.get(label) ?? {};
}

/**
 * Take into a label's dropdowns the values its live quads just announced.
 *
 * A value that has newly appeared is IN the quad that announced it, so a view learns it from what it was already sent
 * rather than by asking the server again. Asking again is what made this loop: the question is dispatched as a step,
 * the step is recorded in the graph, and the recording is another change to answer.
 *
 * Only predicates the label already offers gain values. Which predicates are dropdowns at all is the type's own
 * declaration, established by the fetch that built this entry; a quad about any other predicate is not one of them,
 * and a label with no entry yet has not been fetched, so there is nothing to add to. Returns whether anything was
 * added, so a caller re-renders only when the dropdowns changed.
 */
export function addObservedSelectValues(label: string, quads: readonly TQuad[]): boolean {
	const held = selectCache.get(label);
	if (!held) return false;
	let added = false;
	for (const quad of quads) {
		if (quad.namedGraph !== label) continue;
		const values = held[quad.predicate];
		if (!values || typeof quad.object !== "string" || quad.object === "" || values.includes(quad.object)) continue;
		values.push(quad.object);
		values.sort();
		added = true;
	}
	return added;
}

/** Get all site metadata. */
export function getSiteMetadataSync(): SiteMetadata | null {
	return metadata;
}

/** Custom-element tags declared by domain `ui` extensions for one slot. One reader for every slot, so a new place a
 *  concern can mount is a caller passing its slot rather than another near-identical function. */
export function getUiExtensionTags(slot: string): string[] {
	return Object.values(metadata?.ui || {})
		.filter((ui) => ui.slot === slot && typeof ui.component === "string")
		.map((ui) => String(ui.component));
}

/** Custom-element tags for the bar's input line, mounted in every mode: the bar renders them where it owns the line,
 *  and the ask pane where the pane owns it. */
export function getActionBarChatExtensionTags(): string[] {
	return getUiExtensionTags(ACTION_BAR_CHAT_SLOT);
}

/** Custom-element tags for the ask's own row, mounted under ask mode alone. */
export function getActionBarAskExtensionTags(): string[] {
	return getUiExtensionTags(ACTION_BAR_ASK_SLOT);
}

/** Get the edge name → rel mapping from concern catalog. Cached; rebuilt on setConcernCatalog. */
export function getEdgeRelMap(): Record<string, string> {
	if (!cachedEdgeRelRecord) cachedEdgeRelRecord = Object.fromEntries(edgeRelMap);
	return cachedEdgeRelRecord;
}

/** Check if a label has select values cached. */
export function hasSelectValues(label: string): boolean {
	return selectCache.has(label);
}

/** Check if a label holds at least one non-empty select-value list, usable dropdown options, as opposed to a cached-empty result fetched before the data existed. */
export function hasUsableSelectValues(label: string): boolean {
	return Object.values(getSelectValues(label)).some((v) => v.length > 0);
}

// --- Concern catalog (for haibun domain discovery) ---

import type { TConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { LinkRelations, getPropertyDefinitions, isSubPropertyOf, roleRels, fromActorRels, toActorRels } from "@haibun/core/lib/resources.js";
import { pagePinned } from "./page-pinned.js";

// What the site declares is one thing per page, and a page is more than one bundle: the app, the graph view, a panel a
// deployment adds. Held per bundle, whichever bundle did not ask the site would have no vocabulary at all.
const CATALOG_KEY = "__SHU_CONCERN_CATALOG__";
type TDeclared = { catalog: TConcernCatalog | null; meta: SiteMetadata | null };
const declared = (): TDeclared => pagePinned(CATALOG_KEY, () => ({ catalog: null, meta: null }));

/** The catalog the page holds, or null before any bundle has asked the site. For a caller deciding whether to derive;
 *  a reader that needs the catalog to exist uses getConcernCatalog. */
export function cachedConcernCatalog(): TConcernCatalog | null {
	return declared().catalog;
}

type TDomainUiInfo = { ui?: Record<string, unknown> };

const edgeRelMap = new Map<string, string>();
let cachedEdgeRelRecord: Record<string, string> | null = null;
// The catalog this bundle last derived from. The catalog is the page's; everything derived from it here (the site
// metadata, the edge index, the role caches) is this bundle's own, so each bundle derives once per catalog and a
// repeat is a no-op. That keeps what a view merged onto the metadata afterward, instead of rebuilding over it.
let derivedFromCatalog: TConcernCatalog | null = null;

/** Set the concern catalog from step.list response. Caches derived SiteMetadata and edge→rel map. */
export function setConcernCatalog(catalog: TConcernCatalog, domains?: Record<string, TDomainUiInfo>): void {
	if (catalog === derivedFromCatalog) return;
	derivedFromCatalog = catalog;
	const meta = siteMetadataFromConcerns(catalog, domains);
	declared().catalog = catalog;
	declared().meta = meta;
	setSiteMetadata(meta);
	edgeRelMap.clear();
	cachedEdgeRelRecord = null;
	cachedRoleEdgeLabels = null;
	cachedRoleEdgeLabelSet = null;
	cachedFromActorEdgeLabels = null;
	cachedToActorEdgeLabels = null;
	cachedRoleNouns = null;
	for (const concern of Object.values(catalog.persisted)) {
		for (const [edgeName, edge] of Object.entries(concern.edges)) {
			edgeRelMap.set(edgeName, edge.rel);
		}
	}
}

/** Get cached SiteMetadata derived from concerns. */
export function getConcernDerivedMetadata(): SiteMetadata {
	const meta = declared().meta;
	if (!meta) throw new Error("Concern catalog not initialized.");
	return meta;
}

/** Get the concern catalog (populated from step.list). */
export function getConcernCatalog(): TConcernCatalog {
	const catalog = declared().catalog;
	if (!catalog) throw new Error("Concern catalog not initialized. Call setConcernCatalog() first.");
	return catalog;
}

// A registered type's description. Undefined for ad-hoc result views that aren't a registered type.
export function getTypeDescription(label: string): string | undefined {
	return declared().catalog?.persisted[label]?.description;
}

/** Derive SiteMetadata from the concern catalog. Covers any stepper that declares persisted concerns. */
export function siteMetadataFromConcerns(catalog: TConcernCatalog, domains?: Record<string, TDomainUiInfo>): SiteMetadata {
	const types: string[] = [];
	const idFields: Record<string, string> = {};
	const rels: Record<string, Record<string, string>> = {};
	const edgeRanges: Record<string, Record<string, string>> = {};
	const properties: Record<string, string[]> = {};
	const queryable: Record<string, string[]> = {};
	const validTimeFields: Record<string, string> = {};
	const summary: Record<string, string[]> = {};
	const ui: Record<string, Record<string, unknown>> = {};
	const classIris: Record<string, string> = {};
	const displayLabelRels: Record<string, string> = {};
	for (const [label, concern] of Object.entries(catalog.persisted)) {
		types.push(label);
		if (concern.displayLabel) displayLabelRels[label] = concern.displayLabel;
		idFields[label] = concern.idField;
		if (concern.asType) classIris[label] = concern.asType;
		if (concern.queryable.length > 0) queryable[label] = concern.queryable;
		validTimeFields[label] = concern.validTimeField;
		const labelRels: Record<string, string> = {};
		const labelProps: string[] = [];
		const labelSummary: string[] = [];
		for (const [field, prop] of Object.entries(concern.properties)) {
			labelRels[field] = prop.rel;
			labelProps.push(field);
			if (prop.rel === LinkRelations.NAME.rel || prop.rel === LinkRelations.CONTEXT.rel) labelSummary.push(field);
		}
		rels[label] = labelRels;
		properties[label] = labelProps;
		if (labelSummary.length > 0) summary[label] = labelSummary;
		const labelEdges: Record<string, string> = {};
		for (const [edgeName, edge] of Object.entries(concern.edges)) {
			labelEdges[edgeName] = edge.target;
		}
		if (Object.keys(labelEdges).length > 0) edgeRanges[label] = labelEdges;
		if (concern.ui) ui[label] = concern.ui;
	}
	if (domains) {
		const seenComponents = new Set<string>();
		for (const entry of Object.values(ui)) {
			if (typeof entry?.component === "string") seenComponents.add(entry.component);
		}
		for (const [domainKey, info] of Object.entries(domains)) {
			if (!info?.ui || ui[domainKey]) continue;
			// A single concern that declares both `topology.persistedAs` and a `selector`
			// arrives twice, once via catalog.persisted (keyed by label), once via
			// `domains` (keyed by selector). Dedup by component so one declaration
			// produces one rendered element, not two.
			const component = typeof info.ui.component === "string" ? info.ui.component : null;
			if (component && seenComponents.has(component)) continue;
			ui[domainKey] = info.ui;
			if (component) seenComponents.add(component);
		}
	}
	const propertyDefinitions: Record<string, PropertyDefinition> = {};
	for (const entry of getPropertyDefinitions()) {
		const def: PropertyDefinition = { iri: entry.iri, range: entry.range };
		if (entry.label !== undefined) def.label = entry.label;
		if (entry.icon !== undefined) def.icon = entry.icon;
		if (entry.subPropertyOf !== undefined) def.subPropertyOf = entry.subPropertyOf;
		if (entry.presentation !== undefined) def.presentation = entry.presentation;
		propertyDefinitions[entry.id] = def;
	}
	return {
		types,
		idFields,
		rels,
		edgeRanges,
		properties,
		queryable,
		validTimeFields,
		summary,
		ui,
		propertyDefinitions,
		classIris,
		displayLabelRels,
	};
}

// --- Actor-edge classification (role merge / sequence orientation) ---

/**
 * Actor edge labels classified under `upper`, with ordering weights: core's concrete rels declared subPropertyOf
 * `upper` (each carrying its declared rolePriority), plus every concern edge whose rel classifies under `upper`:
 * a consumer edge declares an upper-ontology pointer (fromActor/toActor/…) as its rel and carries its own
 * rolePriority in its domain declaration. Unranked labels weigh 0. No consumer vocabulary is named anywhere here.
 */
function actorEdgeWeights(upper: string, coreRels: ReadonlySet<string>): Map<string, number> {
	const corePriority = new Map(getPropertyDefinitions().map((d) => [d.id, d.rolePriority ?? 0]));
	const weights = new Map<string, number>();
	for (const rel of coreRels) weights.set(rel, corePriority.get(rel) ?? 0);
	for (const concern of Object.values(declared().catalog?.persisted ?? {})) {
		for (const [edgeName, edge] of Object.entries(concern.edges)) {
			if (!isSubPropertyOf(edge.rel, upper)) continue;
			const weight = (edge as { rolePriority?: number }).rolePriority ?? 0;
			weights.set(edgeName, Math.max(weights.get(edgeName) ?? 0, weight));
		}
	}
	return weights;
}

let cachedRoleEdgeLabels: readonly string[] | null = null;
let cachedRoleEdgeLabelSet: ReadonlySet<string> | null = null;
let cachedFromActorEdgeLabels: ReadonlySet<string> | null = null;
let cachedToActorEdgeLabels: ReadonlySet<string> | null = null;
let cachedRoleNouns: ReadonlyMap<string, string> | null = null;

/** Role-attribution edge labels, highest declared rolePriority first (ties by name): when a node carries several role
 *  edges, the first present names its container/lane. Ontology + catalog derived, never a hand-kept list. */
export function roleEdgeLabels(): readonly string[] {
	if (!cachedRoleEdgeLabels) {
		const weights = actorEdgeWeights(LinkRelations.IN_ROLE_OF.rel, roleRels());
		cachedRoleEdgeLabels = [...weights.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
	}
	return cachedRoleEdgeLabels;
}

/** Membership form of roleEdgeLabels. */
export function roleEdgeLabelSet(): ReadonlySet<string> {
	cachedRoleEdgeLabelSet ??= new Set(roleEdgeLabels());
	return cachedRoleEdgeLabelSet;
}

/** The SOURCE-side actor edge labels: a sequence reads these as the lifeline an entity originates from. */
export function fromActorEdgeLabels(): ReadonlySet<string> {
	cachedFromActorEdgeLabels ??= new Set(actorEdgeWeights(LinkRelations.FROM_ACTOR.rel, fromActorRels()).keys());
	return cachedFromActorEdgeLabels;
}

/**
 * The noun a party displays under, given the edge by which others attribute to it: `X issuer→ P` makes P an
 * "Issuer". Read from the declarations, so a view names no vocabulary of its own: a deployment that declares no
 * role nouns gets none, and one that declares them gets exactly what it declared.
 */
export function roleNounFor(edgeLabel: unknown): string | undefined {
	if (!cachedRoleNouns) {
		const nouns = new Map<string, string>();
		for (const concern of Object.values(getConcernCatalog().persisted)) {
			for (const [edgeName, edge] of Object.entries(concern.edges)) if (edge.roleNoun) nouns.set(edgeName, edge.roleNoun);
		}
		cachedRoleNouns = nouns;
	}
	return typeof edgeLabel === "string" ? cachedRoleNouns.get(edgeLabel) : undefined;
}

/** The TARGET-side actor edge labels: a sequence reads these as the lifeline a message is directed to. */
export function toActorEdgeLabels(): ReadonlySet<string> {
	cachedToActorEdgeLabels ??= new Set(actorEdgeWeights(LinkRelations.TO_ACTOR.rel, toActorRels()).keys());
	return cachedToActorEdgeLabels;
}

/**
 * The @types the actor edges of these types point at: who an exchange between them is with. Read from the declared
 * ranges rather than from the quads a reading holds, because a type left out of a reading is not fetched, so the edges
 * that would name it an actor are not there to be read, which is when a view built on actors has to know.
 */
export function actorTypesFor(sourceTypes: Iterable<string>): string[] {
	const actorEdges = new Set([...fromActorEdgeLabels(), ...toActorEdgeLabels()]);
	const types = new Set<string>();
	for (const source of sourceTypes) for (const [edge, target] of Object.entries(metadata?.edgeRanges[source] ?? {})) if (target && actorEdges.has(edge)) types.add(target);
	return [...types];
}

/** A concern-declared edge's display phrase (its declared label), else undefined: how a consumer's edge names the
 *  role a linked party plays without that vocabulary appearing in any component. First declaration wins. */
export function getDeclaredEdgeLabel(edgeName: string): string | undefined {
	for (const concern of Object.values(declared().catalog?.persisted ?? {})) {
		const label = (concern.edges[edgeName] as { label?: string } | undefined)?.label;
		if (label) return label;
	}
	return undefined;
}
