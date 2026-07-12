/**
 * Schema metadata cache — populated once from getSiteMetadata RPC call.
 * Provides rels, edge ranges, and properties for all node types.
 */
import { propertyVocabulary } from "./graph/ontology-projection.js";

/**
 * Per-rel runtime metadata — the Property node projection.
 * Keyed by rel name (e.g. "hasBody"), one entry per RDF Property.
 *   iri            — RDFS URI for the rel (rdfs:Property's @id).
 *   range          — RDF range: "iri" | "literal" | "container".
 *   label          — display name for renderers (rdfs:label).
 *   icon           — visual badge for the rel.
 *   subPropertyOf  — parent rel (rdfs:subPropertyOf) for ancestry walks.
 *   presentation   — rendering bucket: "summary" | "body" | "governance".
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
	/** Per label, the field carrying the type's valid time (the catalog's validTimeField — where the term is defined). */
	validTimeFields: Record<string, string>;
	summary: Record<string, string[]>;
	ui: Record<string, Record<string, unknown>>;
	/** Per-rel metadata (label, icon, subPropertyOf, presentation, range, iri). */
	propertyDefinitions: Record<string, PropertyDefinition>;
	/** Per label, the type's class IRI (topology.type / the concern's asType), when it declares one — lets a view tell a
	 *  haibun-namespace (system) type from a standard/consumer one. The builder always sets it; optional for partial fixtures. */
	classIris?: Record<string, string>;
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

/** Every persisted type label the site declares — the whole schema vocabulary. Empty until metadata lands. */
export function getTypes(): string[] {
	return metadata?.types ?? [];
}

/** The concern whose ui declares it PRESENTS a capability (ui.presents, e.g. "graph" for the site's graph view), so a
 *  view can embed the site's presenter for that capability without naming any concrete component. */
export function getUiPresenting(kind: string): { type: string; ui: Record<string, unknown> } | undefined {
	for (const [type, ui] of Object.entries(metadata?.ui ?? {})) if (ui.presents === kind) return { type, ui };
	return undefined;
}

/** Sync lookup — returns cached rel for a property. */
export function getRelSync(label: string, property: string): string | undefined {
	return metadata?.rels[label]?.[property];
}

/** Whether a type is a SYSTEM schema — its class IRI is haibun's own vocabulary (a haibun-namespace prefix), as opposed
 *  to a standard's (cred:/prov:/…) or a consumer's coined one. A verifiable credential (cred:VerifiableCredential) is not
 *  a system schema; a haibun-defined type (e.g. hbn:SeqPath) is. False when the type declares no class IRI. */
export function isSystemSchemaType(label: string): boolean {
	const iri = metadata?.classIris?.[label];
	return iri !== undefined && propertyVocabulary(iri).source === "haibun";
}

/** Get cached edge ranges for a label. */
export function getEdgeRanges(label: string): Record<string, string> | undefined {
	return metadata?.edgeRanges[label];
}

/** Sync lookup — returns target label for an edge type from a source node label. Falls back to global index. */
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
	return metadata?.ui[label];
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

/** Get cached select (dropdown) field values for a label. */
export function getSelectValues(label: string): Record<string, string[]> {
	return selectCache.get(label) ?? {};
}

/** Get all site metadata. */
export function getSiteMetadataSync(): SiteMetadata | null {
	return metadata;
}

/** Custom-element tags declared by domain `ui` extensions for the actions-bar chat row.
 *  Rendered identically in ask and step modes, so both the actions bar and the kihan chat read it here. */
export function getActionBarChatExtensionTags(): string[] {
	return Object.values(metadata?.ui || {})
		.filter((ui) => ui.slot === "action-bar-chat" && typeof ui.component === "string")
		.map((ui) => String(ui.component));
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

/** Check if a label holds at least one non-empty select-value list — usable dropdown options, as opposed to a cached-empty result fetched before the data existed. */
export function hasUsableSelectValues(label: string): boolean {
	return Object.values(getSelectValues(label)).some((v) => v.length > 0);
}

// --- Concern catalog (for haibun domain discovery) ---

import type { TConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { LinkRelations, getPropertyDefinitions } from "@haibun/core/lib/resources.js";

let concernCatalog: TConcernCatalog | null = null;
let cachedConcernMeta: SiteMetadata | null = null;

type TDomainUiInfo = { ui?: Record<string, unknown> };

const edgeRelMap = new Map<string, string>();
let cachedEdgeRelRecord: Record<string, string> | null = null;

/** Set the concern catalog from step.list response. Caches derived SiteMetadata and edge→rel map. */
export function setConcernCatalog(catalog: TConcernCatalog, domains?: Record<string, TDomainUiInfo>): void {
	concernCatalog = catalog;
	cachedConcernMeta = siteMetadataFromConcerns(catalog, domains);
	setSiteMetadata(cachedConcernMeta);
	edgeRelMap.clear();
	cachedEdgeRelRecord = null;
	for (const concern of Object.values(catalog.persisted)) {
		for (const [edgeName, edge] of Object.entries(concern.edges)) {
			edgeRelMap.set(edgeName, edge.rel);
		}
	}
}

/** Get cached SiteMetadata derived from concerns. */
export function getConcernDerivedMetadata(): SiteMetadata {
	if (!cachedConcernMeta) throw new Error("Concern catalog not initialized.");
	return cachedConcernMeta;
}

/** Get the concern catalog (populated from step.list). */
export function getConcernCatalog(): TConcernCatalog {
	if (!concernCatalog) {
		throw new Error("Concern catalog not initialized. Call setConcernCatalog() first.");
	}
	return concernCatalog;
}

// A registered type's description. Undefined for ad-hoc result views that aren't a registered type.
export function getTypeDescription(label: string): string | undefined {
	return concernCatalog?.persisted[label]?.description;
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
	for (const [label, concern] of Object.entries(catalog.persisted)) {
		types.push(label);
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
			// arrives twice — once via catalog.persisted (keyed by label), once via
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
	};
}
