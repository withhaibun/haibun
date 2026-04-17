/**
 * Resource type rel-to-field mapping, built from concern metadata.
 * Provides RDF-compatible field lookups by ActivityStreams/FOAF rels.
 */
import { getRel, LinkRelations, type TRegisteredDomain, type TPropertyDef } from "./defs.js";

/** Rel-to-field lookup for resource types. */
export type ResourceRels = {
	types: string[];
	field(type: string, rel: string): string | undefined;
	idField(type: string): string;
	publishedField(type: string): string | undefined;
	nameField(type: string): string | undefined;
	contentField(type: string): string | undefined;
	fields(type: string): Record<string, string>;
};

/** Build ResourceRels from world.domains concern metadata. */
export function buildResourceRels(domains: Record<string, TRegisteredDomain>): ResourceRels {
	const types: string[] = [];
	const idFields = new Map<string, string>();
	const relMaps = new Map<string, Record<string, string>>();

	for (const domain of Object.values(domains)) {
		const topology = domain.topology;
		if (!topology?.vertexLabel) continue;
		const type = topology.vertexLabel;
		types.push(type);
		idFields.set(type, topology.id);
		const rels: Record<string, string> = {};
		for (const [field, def] of Object.entries(topology.properties ?? {})) {
			rels[field] = getRel(def as TPropertyDef);
		}
		relMaps.set(type, rels);
	}

	const fieldByRel = (type: string, rel: string): string | undefined => {
		const rels = relMaps.get(type);
		if (!rels) return undefined;
		for (const [field, r] of Object.entries(rels)) {
			if (r === rel) return field;
		}
		return undefined;
	};

	return {
		types,
		field: fieldByRel,
		idField: (type) => {
			const id = idFields.get(type);
			if (!id) throw new Error(`Unknown resource type: ${type}`);
			return id;
		},
		publishedField: (type) => fieldByRel(type, LinkRelations.PUBLISHED.rel),
		nameField: (type) => fieldByRel(type, LinkRelations.NAME.rel),
		contentField: (type) => fieldByRel(type, LinkRelations.CONTENT.rel),
		fields: (type) => relMaps.get(type) ?? {},
	};
}

/** Parse a value as epoch ms (ISO date string or number). */
export function parseTimestampValue(val: unknown): number | null {
	if (typeof val === "number") return val;
	if (typeof val === "string") {
		const d = new Date(val);
		if (!Number.isNaN(d.getTime())) return d.getTime();
	}
	return null;
}
