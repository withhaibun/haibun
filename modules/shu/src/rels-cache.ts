/**
 * Schema metadata cache — populated once from getSiteMetadata RPC call.
 * Provides rels, edge ranges, and properties for all vertex types.
 */

export interface SiteMetadata {
	types: string[];
	idFields: Record<string, string>;
	rels: Record<string, Record<string, string>>;
	edgeRanges: Record<string, Record<string, string>>;
	properties: Record<string, string[]>;
	summary: Record<string, string[]>;
	contentFields: Record<string, Record<string, string>>;
}

let metadata: SiteMetadata | null = null;
const edgeTypeIndex = new Map<string, string>();

/** Populate the cache from a getSiteMetadata response. Called once at startup. */
export function setSiteMetadata(data: SiteMetadata): void {
	metadata = data;
	edgeTypeIndex.clear();
	for (const ranges of Object.values(data.edgeRanges)) {
		for (const [edge, target] of Object.entries(ranges)) {
			edgeTypeIndex.set(edge, target);
		}
	}
}

/** Get cached rels for a label. Returns undefined if metadata not initialized or label unknown. */
export function getRels(label: string): Record<string, string> | undefined {
	return metadata?.rels[label];
}

/** Sync lookup — returns cached rel for a property. */
export function getRelSync(label: string, property: string): string | undefined {
	return metadata?.rels[label]?.[property];
}

/** Get cached edge ranges for a label. */
export function getEdgeRanges(label: string): Record<string, string> | undefined {
	return metadata?.edgeRanges[label];
}

/** Sync lookup — returns target label for an edge type from a source vertex label. Falls back to global index. */
export function getEdgeTargetLabel(edgeType: string, sourceLabel?: string): string | undefined {
	if (sourceLabel) {
		const target = metadata?.edgeRanges[sourceLabel]?.[edgeType];
		if (target) return target;
	}
	return edgeTypeIndex.get(edgeType);
}

/** Sync lookup — returns edge types whose target is a given label. */
export function getEdgeTypesForLabel(targetLabel: string): Set<string> {
	const types = new Set<string>();
	for (const [edge, label] of edgeTypeIndex) {
		if (label === targetLabel) types.add(edge);
	}
	return types;
}

/** Get cached properties for a label. */
export function getProperties(label: string): string[] | undefined {
	return metadata?.properties[label];
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

/** Get content fields (in preference order) for a label — rendered in an iframe. */
export function getContentFields(label: string): Record<string, string> | undefined {
	return metadata?.contentFields[label];
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

/** Get the edge name → rel mapping from concern catalog. Cached; rebuilt on setConcernCatalog. */
export function getEdgeRelMap(): Record<string, string> {
	if (!cachedEdgeRelRecord) cachedEdgeRelRecord = Object.fromEntries(edgeRelMap);
	return cachedEdgeRelRecord;
}

/** Check if a label has select values cached. */
export function hasSelectValues(label: string): boolean {
	return selectCache.has(label);
}

// --- Concern catalog (for haibun domain discovery) ---

import type { TConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { LinkRelations } from "@haibun/core/lib/defs.js";

let concernCatalog: TConcernCatalog | null = null;
let cachedConcernMeta: SiteMetadata | null = null;

const edgeRelMap = new Map<string, string>();
let cachedEdgeRelRecord: Record<string, string> | null = null;

/** Set the concern catalog from step.list response. Caches derived SiteMetadata and edge→rel map. */
export function setConcernCatalog(catalog: TConcernCatalog): void {
	concernCatalog = catalog;
	cachedConcernMeta = siteMetadataFromConcerns(catalog);
	edgeRelMap.clear();
	cachedEdgeRelRecord = null;
	for (const vertex of Object.values(catalog.vertices)) {
		for (const [edgeName, edge] of Object.entries(vertex.edges)) {
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

/** Derive SiteMetadata from the concern catalog. Covers any stepper that declares vertex concerns. */
export function siteMetadataFromConcerns(catalog: TConcernCatalog): SiteMetadata {
	const types: string[] = [];
	const idFields: Record<string, string> = {};
	const rels: Record<string, Record<string, string>> = {};
	const edgeRanges: Record<string, Record<string, string>> = {};
	const properties: Record<string, string[]> = {};
	const summary: Record<string, string[]> = {};
	const contentFields: Record<string, Record<string, string>> = {};
	for (const [label, vertex] of Object.entries(catalog.vertices)) {
		types.push(label);
		idFields[label] = vertex.idField;
		const labelRels: Record<string, string> = {};
		const labelProps: string[] = [];
		const labelSummary: string[] = [];
		const labelContent: Record<string, string> = {};
		for (const [field, prop] of Object.entries(vertex.properties)) {
			labelRels[field] = prop.rel;
			labelProps.push(field);
			if (prop.rel === LinkRelations.NAME.rel || prop.rel === LinkRelations.CONTEXT.rel) labelSummary.push(field);
			if (prop.mediaType) labelContent[field] = prop.mediaType;
		}
		rels[label] = labelRels;
		properties[label] = labelProps;
		if (labelSummary.length > 0) summary[label] = labelSummary;
		if (Object.keys(labelContent).length > 0) contentFields[label] = labelContent;
		const labelEdges: Record<string, string> = {};
		for (const [, edge] of Object.entries(vertex.edges)) {
			labelEdges[edge.rel] = edge.target;
		}
		if (Object.keys(labelEdges).length > 0) edgeRanges[label] = labelEdges;
	}
	return {
		types,
		idFields,
		rels,
		edgeRanges,
		properties,
		summary,
		contentFields,
	};
}
