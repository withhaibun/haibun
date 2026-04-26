/**
 * Hypermedia concern catalog — canonical contract between server and SPA.
 *
 * Grounded in ActivityStreams / JSON-LD.  Derived entirely from getConcerns domains
 * with TDomainTopology: one declaration drives CRUD, JSON-LD context, and UI behaviour.
 *
 * StepDiscovery (step.list) embeds a ConcernCatalog so any client (shu, MCP, ...)
 * receives machine-readable hypermedia metadata without a separate RPC call.
 */

import { z } from "zod";
import { edgeRel, REL_CONTEXT, LinkRelations, getRelRange, type TPropertyDef } from "./resources.js";
import type { TRegisteredDomain } from "./resources.js";

/** Per-schema JSON-Schema memoization. `step.list` RPC calls buildConcernCatalog repeatedly; each
 *  domain's `z.toJSONSchema` traversal is stable per schema instance, so cache by identity. */
const jsonSchemaCache = new WeakMap<z.ZodType, Record<string, unknown>>();
function toJsonSchemaCached(schema: z.ZodType): Record<string, unknown> {
	const hit = jsonSchemaCache.get(schema);
	if (hit) return hit;
	try {
		const js = z.toJSONSchema(schema) as Record<string, unknown>;
		jsonSchemaCache.set(schema, js);
		return js;
	} catch {
		const empty: Record<string, unknown> = {};
		jsonSchemaCache.set(schema, empty);
		return empty;
	}
}

// ============================================================================
// Schemas  (Zod → TypeScript, Zod → JSON Schema — single source of truth)
// ============================================================================

const relValues = Object.values(LinkRelations).map((lr) => lr.rel) as [string, ...string[]];
export const RelSchema = z.enum(relValues);

/** A single vertex property mapped to its ActivityStreams predicate. */
const PropertyConcernSchema = z.object({
	term: z.string(),
	rel: RelSchema,
});
type TPropertyConcern = z.infer<typeof PropertyConcernSchema>;

/** An outgoing edge with its ActivityStreams predicate and target vertex label. */
const EdgeConcernSchema = z.object({
	term: z.string(),
	rel: RelSchema,
	target: z.string(),
});
type TEdgeConcern = z.infer<typeof EdgeConcernSchema>;

/** Complete hypermedia description of a vertex type. */
const VertexConcernSchema = z.object({
	domainKey: z.string(),
	label: z.string(),
	idField: z.string(),
	/** ActivityStreams @type  e.g. "as:Note" */
	asType: z.string().optional(),
	/** JSON Schema derived from the Zod domain schema at registration time. */
	jsonSchema: z.record(z.string(), z.unknown()),
	properties: z.record(z.string(), PropertyConcernSchema),
	edges: z.record(z.string(), EdgeConcernSchema).default({}),
	/** UI metadata: slot, component, JS source, etc. */
	ui: z.record(z.string(), z.unknown()).optional(),
});
type TVertexConcern = z.infer<typeof VertexConcernSchema>;

/** All vertex concerns emitted by a running server, keyed by vertex label. */
export const ConcernCatalogSchema = z.object({
	vertices: z.record(z.string(), VertexConcernSchema),
});
export type TConcernCatalog = z.infer<typeof ConcernCatalogSchema>;

// ============================================================================
// Builder
// ============================================================================

/**
 * Build a ConcernCatalog from world.domains after getConcerns has run.
 * Non-vertex domains (no topology.vertexLabel) are skipped.
 * Vertex domains are validated: id, properties, and valid rels are required.
 */
export function buildConcernCatalog(domains: Record<string, TRegisteredDomain>): TConcernCatalog {
	const vertices: Record<string, TVertexConcern> = {};

	for (const [domainKey, domain] of Object.entries(domains)) {
		const topology = domain.topology;
		if (!topology?.vertexLabel) continue;
		const label = topology.vertexLabel;

		if (!topology.id) throw new Error(`Vertex domain "${label}" (${domainKey}) is missing required "id" field`);
		if (!topology.properties || Object.keys(topology.properties).length === 0)
			throw new Error(`Vertex domain "${label}" (${domainKey}) has no properties`);

		const hasIdentifier = Object.values(topology.properties).some((p) => p === LinkRelations.IDENTIFIER.rel);
		if (!hasIdentifier)
			throw new Error(`Vertex domain "${label}" (${domainKey}) has no property with rel "${LinkRelations.IDENTIFIER.rel}"`);

		const properties: Record<string, TPropertyConcern> = {};
		for (const [field, propDef] of Object.entries(topology.properties)) {
			const rel = propDef;
			if (!REL_CONTEXT[rel]) throw new Error(`Vertex domain "${label}" property "${field}" has unknown rel "${rel}"`);
			properties[field] = { term: REL_CONTEXT[rel], rel };
		}

		const edges: Record<string, TEdgeConcern> = {};
		for (const [edgeField, edgeDef] of Object.entries(topology.edges ?? {})) {
			const rel = edgeDef.rel ?? edgeRel(edgeField);
			if (!rel) throw new Error(`Vertex domain "${label}" edge "${edgeField}" has no rel — add to EdgePredicates or provide explicit rel`);
			if (!REL_CONTEXT[rel]) throw new Error(`Vertex domain "${label}" edge "${edgeField}" has unknown rel "${rel}"`);
			edges[edgeField] = { term: REL_CONTEXT[rel], rel, target: edgeDef.range };
		}

		const jsonSchema = toJsonSchemaCached(domain.schema);

		vertices[label] = VertexConcernSchema.parse({
			domainKey,
			label,
			idField: topology.id,
			...(topology.type ? { asType: topology.type } : {}),
			jsonSchema,
			properties,
			edges,
			...(domain.ui ? { ui: domain.ui } : {}),
		});
	}

	return { vertices };
}

// ============================================================================
// Resource rels — rel-to-field lookups per vertex type
// ============================================================================

/** Rel-to-field lookup for resource types. Derived from topology at runtime. */
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
			rels[field] = def as TPropertyDef;
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

// ============================================================================
// JSON-LD context — derived from domain topology
// ============================================================================

/**
 * Map a rel's RDF range to its UI rendering category.
 *   iri       → "item"    (navigable link to another vertex)
 *   container → "select"  (multi-valued structure; select-like control)
 *   literal   → "filter"  (scalar value; filter/text control)
 *
 * Unknown rels default to "filter" — the safest neutral rendering.
 */
function linkRelFromSemantic(rel: string): "item" | "filter" | "select" {
	const range = getRelRange(rel);
	if (range === "iri") return "item";
	if (range === "container") return "select";
	return "filter";
}

/** Build JSON-LD context from domain topology. Derives URI mappings from domain property rels. */
export function getJsonLdContext(domains: Record<string, TRegisteredDomain>): Record<string, unknown> {
	const context: Record<string, unknown> = {
		"@version": 1.1,
		as: "https://www.w3.org/ns/activitystreams#",
		foaf: "http://xmlns.com/foaf/0.1/",
		dcterms: "http://purl.org/dc/terms/",
		prov: "https://www.w3.org/ns/prov#",
		sosa: "http://www.w3.org/ns/sosa/",
		schema: "https://schema.org/",
		oa: "http://www.w3.org/ns/oa#",
		otel: "https://opentelemetry.io/schemas/",
		hbn: "https://haibun.dev/ns/",
		haibun: "/ns/",
	};
	for (const domain of Object.values(domains)) {
		const topology = domain.topology;
		if (!topology?.vertexLabel) continue;
		for (const [prop, def] of Object.entries(topology.properties)) {
			const rel = def;
			const uri = REL_CONTEXT[rel] ?? `haibun:${prop}`;
			const linkRel = linkRelFromSemantic(rel);
			const node: Record<string, string> = { "@id": uri, "haibun:rel": linkRel };
			if (linkRel === "item") node["@type"] = "@id";
			context[prop] = node;
		}
		for (const [edge, edgeDef] of Object.entries(topology.edges ?? {})) {
			const rel = edgeDef.rel ?? edgeRel(edge);
			context[edge] = { "@id": (rel && REL_CONTEXT[rel]) ?? `haibun:${edge}`, "@type": "@id", "haibun:rel": "item" };
		}
	}
	return { "@context": context };
}
