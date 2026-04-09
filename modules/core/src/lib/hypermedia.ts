/**
 * Hypermedia concern catalog — canonical contract between server and SPA.
 *
 * Grounded in ActivityStreams / JSON-LD.  Derived entirely from getConcerns domains
 * with TVertexMeta: one declaration drives CRUD, JSON-LD context, and UI behaviour.
 *
 * StepDiscovery (step.list) embeds a ConcernCatalog so any client (shu, MCP, ...)
 * receives machine-readable hypermedia metadata without a separate RPC call.
 */

import { z } from "zod";
import { getRel, getMediaType, REL_CONTEXT, LinkRelations, type TRel } from "./defs.js";
import type { TRegisteredDomain } from "./defs.js";

// ============================================================================
// Schemas  (Zod → TypeScript, Zod → JSON Schema — single source of truth)
// ============================================================================

const relValues = Object.values(LinkRelations).map((lr) => lr.rel) as [string, ...string[]];
export const RelSchema = z.enum(relValues);
export type { TRel };

/**
 * A single vertex property mapped to its ActivityStreams predicate.
 * `mediaType` is present only when rel === 'content'.
 */
const PropertyConcernSchema = z.object({
	term: z.string(),
	rel: RelSchema,
	mediaType: z.string().optional(),
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
 * Non-vertex domains (no meta.vertexLabel) are skipped.
 * Vertex domains are validated: id, properties, and valid rels are required.
 */
export function buildConcernCatalog(domains: Record<string, TRegisteredDomain>): TConcernCatalog {
	const vertices: Record<string, TVertexConcern> = {};

	for (const [domainKey, domain] of Object.entries(domains)) {
		const meta = domain.meta;
		if (!meta?.vertexLabel) continue;
		const label = meta.vertexLabel;

		if (!meta.id) throw new Error(`Vertex domain "${label}" (${domainKey}) is missing required "id" field`);
		if (!meta.properties || Object.keys(meta.properties).length === 0)
			throw new Error(`Vertex domain "${label}" (${domainKey}) has no properties`);

		const hasIdentifier = Object.values(meta.properties).some((p) => getRel(p) === LinkRelations.IDENTIFIER.rel);
		if (!hasIdentifier)
			throw new Error(`Vertex domain "${label}" (${domainKey}) has no property with rel "${LinkRelations.IDENTIFIER.rel}"`);

		const properties: Record<string, TPropertyConcern> = {};
		for (const [field, propDef] of Object.entries(meta.properties)) {
			const rel = getRel(propDef);
			if (!REL_CONTEXT[rel]) throw new Error(`Vertex domain "${label}" property "${field}" has unknown rel "${rel}"`);
			const mediaType = getMediaType(propDef);
			properties[field] = { term: REL_CONTEXT[rel], rel, ...(mediaType ? { mediaType } : {}) };
		}

		const edges: Record<string, TEdgeConcern> = {};
		for (const [edgeField, edgeDef] of Object.entries(meta.edges ?? {})) {
			if (!REL_CONTEXT[edgeDef.rel])
				throw new Error(`Vertex domain "${label}" edge "${edgeField}" has unknown rel "${edgeDef.rel}"`);
			edges[edgeField] = { term: REL_CONTEXT[edgeDef.rel], rel: edgeDef.rel, target: edgeDef.range };
		}

		let jsonSchema: Record<string, unknown> = {};
		try {
			jsonSchema = z.toJSONSchema(domain.schema) as Record<string, unknown>;
		} catch {
			/* skip non-representable schemas */
		}

		vertices[label] = VertexConcernSchema.parse({
			domainKey,
			label,
			idField: meta.id,
			...(meta.type ? { asType: meta.type } : {}),
			jsonSchema,
			properties,
			edges,
		});
	}

	return { vertices };
}

// ============================================================================
// JSON-LD context — derived from domain metadata
// ============================================================================

function linkRelFromSemantic(rel: string): "item" | "filter" | "select" {
	if (
		rel === LinkRelations.IDENTIFIER.rel ||
		rel === LinkRelations.ATTRIBUTED_TO.rel ||
		rel === LinkRelations.AUDIENCE.rel ||
		rel === LinkRelations.IN_REPLY_TO.rel ||
		rel === LinkRelations.ATTACHMENT.rel
	)
		return "item";
	if (rel === LinkRelations.CONTEXT.rel) return "select";
	return "filter";
}

/** Build JSON-LD context from concern metadata. Derives URI mappings from domain property rels. */
export function getJsonLdContext(domains: Record<string, TRegisteredDomain>): Record<string, unknown> {
	const context: Record<string, unknown> = {
		"@version": 1.1,
		as: "https://www.w3.org/ns/activitystreams#",
		foaf: "http://xmlns.com/foaf/0.1/",
		dcterms: "http://purl.org/dc/terms/",
		haibun: "/ns/",
	};
	for (const domain of Object.values(domains)) {
		const meta = domain.meta;
		if (!meta?.vertexLabel) continue;
		for (const [prop, def] of Object.entries(meta.properties)) {
			const rel = getRel(def);
			const uri = REL_CONTEXT[rel] ?? `haibun:${prop}`;
			const mediaType = getMediaType(def);
			const linkRel = linkRelFromSemantic(rel);
			const node: Record<string, string> = { "@id": uri, "haibun:rel": linkRel };
			if (linkRel === "item") node["@type"] = "@id";
			if (mediaType) node["as:mediaType"] = mediaType;
			context[prop] = node;
		}
		for (const [edge, edgeDef] of Object.entries(meta.edges ?? {})) {
			context[edge] = { "@id": REL_CONTEXT[edgeDef.rel] ?? `haibun:${edge}`, "@type": "@id", "haibun:rel": "item" };
		}
	}
	return { "@context": context };
}
