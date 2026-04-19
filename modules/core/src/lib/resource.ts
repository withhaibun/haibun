import { z } from "zod";

/**
 * Resource — the universal shape of anything identifiable and typed.
 * `id` is the identifier (IRI in JSON-LD emission), `type` is the RDF class
 * (typically a compact IRI like "vc:VerifiableCredential", mapped to `@type` via JSON-LD context).
 *
 * Field naming follows the W3C VC 2.0 data model (unquoted `id`/`type`); the `@id`/`@type`
 * JSON-LD keywords are produced by the context at serialization time.
 *
 * Domain schemas representing linkable resources extend this. Storage layers may wrap it further
 * (e.g. spopg adds `vertexLabel` + `accessLevel` for its graph store).
 */
export const ResourceSchema = z.object({
	id: z.string(),
	type: z.string(),
});
export type TResource = z.infer<typeof ResourceSchema>;

/** Root vertex label — any resource. Use as edge range when the target is polymorphic. */
export const RESOURCE_LABEL = "Resource";
