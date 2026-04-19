/**
 * Resources — the vocabulary and topology of things stored in the graph.
 *
 * Answers "what is a graph resource, how is it typed, how does it link, and how is it governed?"
 * Pure declarative data: zod schemas, type aliases, vocabulary consts, and tiny pure derivations.
 * No runtime behavior, no node built-ins — browser-safe.
 *
 * Contents:
 *   - Resource identity (id/type), Access levels, Comment vocabulary
 *   - LinkRelations + EdgePredicates: semantic labels for properties and edges (ActivityStreams / JSON-LD)
 *   - TRel / TPropertyDef / TEdgeDef / TDomainTopology: the shape of a vertex-type declaration
 *   - TDomainDefinition / TRegisteredDomain: how steppers register a domain
 *   - Helpers: getRel, getMediaType, edgeRel, isReplyEdge
 *
 * Grounded in JSON-LD / ActivityStreams / RDF — vertex label is a local handle, `type` is the
 * RDF class URI that JSON-LD emits, `id` is the IRI.
 */
import { z } from "zod";

// ============================================================================
// Resource identity
// ============================================================================

/**
 * The universal shape of anything identifiable and typed.
 * `id` is the identifier (IRI in JSON-LD emission), `type` is the RDF class
 * (typically a compact IRI like "vc:VerifiableCredential"; mapped to `@type` via JSON-LD context).
 *
 * Field naming follows the W3C VC 2.0 data model (unquoted `id`/`type`); the `@id`/`@type`
 * JSON-LD keywords are produced by the context at serialization time.
 */
export const ResourceSchema = z.object({
	id: z.string(),
	type: z.string(),
});
export type TResource = z.infer<typeof ResourceSchema>;

/** Root vertex label — any resource. Use as edge range when the target is polymorphic. */
export const RESOURCE_LABEL = "Resource";

// ============================================================================
// Access levels
// ============================================================================

/**
 * Visibility policy for stored resources:
 *   - private: visible only to the resource's owner.
 *   - public: visible to everyone.
 *   - opened: previously private, deliberately widened for audit; history preserves the prior state.
 *
 * Query contexts also accept `all` to mean "do not filter by access level"; this is not
 * a storage value, only a query-time relaxation.
 */
const ACCESS_LEVELS = ["private", "public", "opened"] as const;
const ACCESS_QUERY_LEVELS = [...ACCESS_LEVELS, "all"] as const;

export const AccessLevelSchema = z.enum(ACCESS_LEVELS, {
	message: `accessLevel must be one of ${ACCESS_LEVELS.map((v) => `"${v}"`).join(", ")}`,
});
export type AccessLevel = z.infer<typeof AccessLevelSchema>;
export const Access = AccessLevelSchema.enum;

export const AccessQueryLevelSchema = z.enum(ACCESS_QUERY_LEVELS, {
	message: `accessLevel (query) must be one of ${ACCESS_QUERY_LEVELS.map((v) => `"${v}"`).join(", ")}`,
});
export type AccessQueryLevel = z.infer<typeof AccessQueryLevelSchema>;
export const AccessQuery = AccessQueryLevelSchema.enum;

// ============================================================================
// Comment vocabulary
// ============================================================================

/**
 * Free-text annotation attached to any Resource. Threads via IN_REPLY_TO.
 * The commentsOn edge carries rel IN_REPLY_TO and range Resource.
 */
export const COMMENT_LABEL = "Comment";
export const COMMENT_DOMAIN = "comment";
export const COMMENT_EDGE = "commentsOn";

// ============================================================================
// Link relations & edge predicates (ActivityStreams / JSON-LD vocabulary)
// ============================================================================

/**
 * Link relation types — the canonical set of semantic rels for vertex properties and edges.
 * Declaration order determines column display priority in result tables.
 * `relation: true` marks rels that form conversational/threading links (used by getRelated, View relations).
 */
export const LinkRelations = {
	NAME: { rel: "name", uri: "as:name", relation: false },
	PUBLISHED: { rel: "published", uri: "as:published", relation: false },
	ATTRIBUTED_TO: { rel: "attributedTo", uri: "as:attributedTo", relation: false },
	AUDIENCE: { rel: "audience", uri: "as:to", relation: false },
	CONTEXT: { rel: "context", uri: "as:context", relation: false },
	UPDATED: { rel: "updated", uri: "as:updated", relation: false },
	CONTENT: { rel: "content", uri: "as:content", relation: false },
	IN_REPLY_TO: { rel: "inReplyTo", uri: "as:inReplyTo", relation: true },
	ATTACHMENT: { rel: "attachment", uri: "as:attachment", relation: false },
	TAG: { rel: "tag", uri: "as:tag", relation: false },
	IDENTIFIER: { rel: "identifier", uri: "dcterms:identifier", relation: false },
	URL: { rel: "url", uri: "as:url", relation: false },
} as const;

export type TRel = (typeof LinkRelations)[keyof typeof LinkRelations]["rel"];

/** JSON-LD context mapping: rel → standard URI. Derived from LinkRelations. */
export const REL_CONTEXT: Record<TRel, string> = Object.fromEntries(
	Object.values(LinkRelations).map(({ rel, uri }) => [rel, uri]),
) as Record<TRel, string>;

/**
 * Standard edge predicates for graph vertices.
 * Each carries its LinkRelation rel — the single source of truth for predicate→rel resolution.
 * Steppers use these as edge keys in getConcerns().edges and in createEdge() calls.
 */
export const EdgePredicates = {
	from: { rel: LinkRelations.ATTRIBUTED_TO.rel },
	to: { rel: LinkRelations.AUDIENCE.rel },
	cc: { rel: LinkRelations.AUDIENCE.rel },
	author: { rel: LinkRelations.ATTRIBUTED_TO.rel },
	attachment: { rel: LinkRelations.ATTACHMENT.rel },
	inReplyTo: { rel: LinkRelations.IN_REPLY_TO.rel },
	references: { rel: LinkRelations.CONTEXT.rel },
	commentsOn: { rel: LinkRelations.IN_REPLY_TO.rel },
	endpoint: { rel: LinkRelations.URL.rel },
} as const;

export type TEdgePredicate = keyof typeof EdgePredicates;

/** Edge predicate name strings — use `EDGE.from` instead of `"from"`. */
export const EDGE: { [K in TEdgePredicate]: K } = Object.fromEntries(Object.keys(EdgePredicates).map((k) => [k, k])) as {
	[K in TEdgePredicate]: K;
};

/** Resolve a predicate name to its rel. */
export function edgeRel(predicate: string): TRel | undefined {
	return (EdgePredicates as Record<string, { rel: TRel }>)[predicate]?.rel;
}

/** Rel values that are reply-type (derived from LinkRelations entries with relation: true). */
const relationRels: Set<string> = new Set(
	Object.values(LinkRelations)
		.filter((lr) => lr.relation)
		.map((lr) => lr.rel),
);

/** Check if a rel value is a reply-type (conversational/threading link). */
function isRelationRel(rel: string): boolean {
	return relationRels.has(rel);
}

/**
 * Check if an edge type (predicate name or rel) is a reply-type link.
 * Resolves predicate names via EdgePredicates, then checks the rel.
 */
export function isReplyEdge(edgeType: string): boolean {
	if (isRelationRel(edgeType)) return true;
	const rel = edgeRel(edgeType);
	return rel ? isRelationRel(rel) : false;
}

// ============================================================================
// Vertex topology: how a stepper declares a vertex type
// ============================================================================

/** Property definition: either a rel string or a rel with mediaType for content fields. */
export type TPropertyDef = TRel | { rel: TRel; mediaType?: string };

/** Edge definition: target vertex type. The rel is resolved from EdgePredicates[key]; override with explicit rel for domain-specific edges not in the canonical set. */
export type TEdgeDef = { range: string; rel?: TRel };

/** Domain topology — vertex label, id field, property rels, edges, indexes. Drives CRUD, JSON-LD, and UI. */
export type TDomainTopology = {
	vertexLabel: string;
	type?: string;
	id: string;
	properties: Record<string, TPropertyDef>;
	edges?: Record<string, TEdgeDef>;
	/** DB-specific: which properties to index for fast lookup. */
	propertyIndexes?: string[];
	/** DB-specific: default sort columns per property. */
	sortColumns?: Record<string, string>;
};

/** Get the rel for a property definition. */
export function getRel(def: TPropertyDef): TRel {
	return typeof def === "string" ? def : def.rel;
}

/** Get the mediaType for a content property, if any. */
export function getMediaType(def: TPropertyDef): string | undefined {
	return typeof def === "string" ? undefined : def.mediaType;
}

/** Domain name for type labels — auto-populated from registered domains with topology. */
export const DOMAIN_VERTEX_LABEL = "vertex-label";

// ============================================================================
// Domain registration shape
// ============================================================================

/** Coercion function: parse a step value (or other proto) into the domain's native representation. */
export type TDomainCoercer = (
	proto: import("../schema/protocol.js").TStepValue,
	featureStep?: import("./execution.js").TFeatureStep,
	steppers?: import("./astepper.js").AStepper[],
) => import("../schema/protocol.js").TStepValueValue;

/** Comparator between two coerced domain values. */
export type TDomainComparator = (
	value: import("../schema/protocol.js").TStepValueValue,
	baseline: import("../schema/protocol.js").TStepValueValue,
) => number;

export type TDomainDefinition = {
	selectors: string[];
	schema: z.ZodType;
	coerce?: TDomainCoercer;
	comparator?: TDomainComparator;
	values?: string[];
	description?: string;
	/** Stepper that registered this domain (set automatically by registerDomains) */
	stepperName?: string;
	/** Vertex topology — label, id, property rels, edges, indexes. Undefined for non-vertex domains. */
	topology?: TDomainTopology;
};

export type TRegisteredDomain = {
	selectors: string[];
	schema: z.ZodType;
	coerce: TDomainCoercer;
	comparator?: TDomainComparator;
	values?: string[];
	description?: string;
	stepperName?: string;
	topology?: TDomainTopology;
};

