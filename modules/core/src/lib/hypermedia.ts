/**
 * Hypermedia concern catalog — canonical contract between server and SPA.
 *
 * Grounded in ActivityStreams / JSON-LD.  Derived entirely from getConcerns domains
 * with TVertexMeta: one declaration drives CRUD, JSON-LD context, and UI behaviour.
 *
 * StepDiscovery (step.list) embeds a ConcernCatalog so any client (shu, MCP, ...)
 * receives machine-readable hypermedia metadata without a separate RPC call.
 */

import { z } from 'zod';
import { getRel, getMediaType, REL_CONTEXT } from './defs.js';
import type { TRegisteredDomain } from './defs.js';

// ============================================================================
// Schemas  (Zod → TypeScript, Zod → JSON Schema — single source of truth)
// ============================================================================

/**
 * Semantic roles — ActivityStreams / Dublin Core vocabulary.
 * Clients derive all UI behaviour from these values alone.
 */
export const RelSchema = z.enum([
  'identifier', 'name', 'attributedTo', 'audience', 'context',
  'published', 'updated', 'content', 'inReplyTo', 'attachment', 'tag',
]);
export type TRel = z.infer<typeof RelSchema>;

/**
 * A single vertex property mapped to its ActivityStreams predicate.
 * `mediaType` is present only when rel === 'content'.
 */
export const PropertyConcernSchema = z.object({
  term: z.string(),
  rel: RelSchema,
  mediaType: z.string().optional(),
});
export type TPropertyConcern = z.infer<typeof PropertyConcernSchema>;

/** An outgoing edge with its ActivityStreams predicate and target vertex label. */
export const EdgeConcernSchema = z.object({
  term: z.string(),
  rel: RelSchema,
  target: z.string(),
});
export type TEdgeConcern = z.infer<typeof EdgeConcernSchema>;

/** Complete hypermedia description of a vertex type. */
export const VertexConcernSchema = z.object({
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
export type TVertexConcern = z.infer<typeof VertexConcernSchema>;

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
 * Non-vertex domains (no meta.vertexLabel) are silently skipped.
 */
export function buildConcernCatalog(domains: Record<string, TRegisteredDomain>): TConcernCatalog {
  const vertices: Record<string, TVertexConcern> = {};

  for (const [domainKey, domain] of Object.entries(domains)) {
    const meta = domain.meta;
    if (!meta?.vertexLabel) continue;
    const label = meta.vertexLabel;

    const properties: Record<string, TPropertyConcern> = {};
    for (const [field, propDef] of Object.entries(meta.properties)) {
      const rel = getRel(propDef);
      const mediaType = getMediaType(propDef);
      properties[field] = { term: REL_CONTEXT[rel], rel, ...(mediaType ? { mediaType } : {}) };
    }

    const edges: Record<string, TEdgeConcern> = {};
    for (const [edgeField, edgeDef] of Object.entries(meta.edges ?? {})) {
      edges[edgeField] = { term: REL_CONTEXT[edgeDef.rel], rel: edgeDef.rel, target: edgeDef.target };
    }

    let jsonSchema: Record<string, unknown> = {};
    try { jsonSchema = z.toJSONSchema(domain.schema) as Record<string, unknown>; } catch { /* skip non-representable schemas */ }

    vertices[label] = VertexConcernSchema.parse({
      domainKey, label, idField: meta.id,
      ...(meta.type ? { asType: meta.type } : {}),
      jsonSchema, properties, edges,
    });
  }

  return { vertices };
}
