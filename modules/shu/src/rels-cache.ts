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

/** Get cached rels for a label. Must call setSiteMetadata() first. */
export function getRels(label: string): Record<string, string> {
	return metadata?.rels[label] ?? {};
}

/** Sync lookup — returns cached rel or "filter" default. */
export function getRelSync(label: string, property: string): string {
	return metadata?.rels[label]?.[property] ?? "filter";
}

/** Get cached edge ranges for a label. */
export function getEdgeRanges(label: string): Record<string, string> {
	return metadata?.edgeRanges[label] ?? {};
}

/** Sync lookup — returns target label for an edge type. O(1). */
export function getEdgeTargetLabel(edgeType: string): string | undefined {
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
export function getProperties(label: string): string[] {
	return metadata?.properties[label] ?? [];
}

/** Get cached summary fields for a label (shown in summary bar, excluded from Details table). */
export function getSummaryFields(label: string): Set<string> {
	return new Set(metadata?.summary[label] ?? []);
}

/** Get content fields (in preference order) for a label — rendered in an iframe. Returns field→format map. */
export function getContentFields(label: string): Record<string, string> {
	return metadata?.contentFields[label] ?? {};
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
