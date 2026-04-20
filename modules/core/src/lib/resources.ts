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
 *
 * `range` is the RDF range of the predicate — what it points at:
 *   - "iri":       points at another resource (an IRI / vertex id). Renders as a navigable item.
 *   - "literal":   points at a literal value (string, number, date). Renders as a filter.
 *   - "container": points at a multi-valued structure (bag, list, or nested context).
 *                  Renders as a select/select-like control.
 *
 * This is a deliberately small subset of RDFS — no reasoner, no subPropertyOf, just enough
 * to let `linkRelFromSemantic` be a one-line lookup instead of a growing if/else chain.
 *
 * `relation` (legacy, retained for back-compat) is true iff `range === "iri"` AND the link
 * participates in conversational/threading semantics (used by getRelated and View relations).
 * Not every IRI-range rel is a "relation" in this sense — e.g. `attributedTo` is IRI-ranged
 * but not a conversational link.
 */
export type TRelRange = "iri" | "literal" | "container";

export const LinkRelations = {
	NAME: { rel: "name", uri: "as:name", range: "literal", relation: false },
	PUBLISHED: { rel: "published", uri: "as:published", range: "literal", relation: false },
	ATTRIBUTED_TO: { rel: "attributedTo", uri: "as:attributedTo", range: "iri", relation: false },
	AUDIENCE: { rel: "audience", uri: "as:to", range: "iri", relation: false },
	CONTEXT: { rel: "context", uri: "as:context", range: "container", relation: false },
	UPDATED: { rel: "updated", uri: "as:updated", range: "literal", relation: false },
	CONTENT: { rel: "content", uri: "as:content", range: "literal", relation: false },
	IN_REPLY_TO: { rel: "inReplyTo", uri: "as:inReplyTo", range: "iri", relation: true },
	ATTACHMENT: { rel: "attachment", uri: "as:attachment", range: "iri", relation: false },
	TAG: { rel: "tag", uri: "as:tag", range: "literal", relation: false },
	IDENTIFIER: { rel: "identifier", uri: "dcterms:identifier", range: "iri", relation: false },
	URL: { rel: "url", uri: "as:url", range: "literal", relation: false },
	// PROV-O — provenance and lineage
	WAS_INFORMED_BY: { rel: "wasInformedBy", uri: "prov:wasInformedBy", range: "iri", relation: true },
	INVALIDATED: { rel: "invalidated", uri: "prov:invalidated", range: "iri", relation: true },
	WAS_ASSOCIATED_WITH: { rel: "wasAssociatedWith", uri: "prov:wasAssociatedWith", range: "iri", relation: false },
	WAS_STARTED_BY: { rel: "wasStartedBy", uri: "prov:wasStartedBy", range: "iri", relation: true },
	STARTED_AT_TIME: { rel: "startedAtTime", uri: "prov:startedAtTime", range: "literal", relation: false },
	// SOSA / W3C SSN — observation and sensing
	PHENOMENON_TIME: { rel: "phenomenonTime", uri: "sosa:phenomenonTime", range: "literal", relation: false },
	RESULT_TIME: { rel: "resultTime", uri: "sosa:resultTime", range: "literal", relation: false },
	HAS_RESULT: { rel: "hasResult", uri: "sosa:hasResult", range: "container", relation: false },
	MADE_BY_SENSOR: { rel: "madeBySensor", uri: "sosa:madeBySensor", range: "iri", relation: true },
	OBSERVED_PROPERTY: { rel: "observedProperty", uri: "sosa:observedProperty", range: "literal", relation: false },
	// schema.org — action outcomes
	SCHEMA_OBJECT: { rel: "schemaObject", uri: "schema:object", range: "literal", relation: false },
	SCHEMA_RESULT: { rel: "schemaResult", uri: "schema:result", range: "literal", relation: false },
	REPLACEE: { rel: "replacee", uri: "schema:replacee", range: "literal", relation: false },
	REPLACEMENT: { rel: "replacement", uri: "schema:replacement", range: "literal", relation: false },
	// Haibun native — no existing vocabulary mapping
	DISCOURSE: { rel: "discourse", uri: "hbn:discourse", range: "literal", relation: false },
	SEQ_PATH: { rel: "seqPath", uri: "hbn:seqPath", range: "literal", relation: false },
	HOST_ID: { rel: "hostId", uri: "hbn:hostId", range: "literal", relation: false },
	ACCESS_LEVEL: { rel: "accessLevel", uri: "hbn:accessLevel", range: "literal", relation: false },
	MEASUREMENT_KIND: { rel: "measurementKind", uri: "hbn:measurementKind", range: "literal", relation: false },
	SHAPE_DIGEST: { rel: "shapeDigest", uri: "hbn:shapeDigest", range: "container", relation: false },
	OUTCOME_REASON: { rel: "outcomeReason", uri: "hbn:outcomeReason", range: "literal", relation: false },
} as const;

/** Lookup a rel's RDF range. Returns undefined for unknown rels. */
export function getRelRange(rel: string): TRelRange | undefined {
	for (const entry of Object.values(LinkRelations)) {
		if (entry.rel === rel) return entry.range;
	}
	return undefined;
}

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
	wasInformedBy: { rel: LinkRelations.WAS_INFORMED_BY.rel },
	invalidated: { rel: LinkRelations.INVALIDATED.rel },
	madeBySensor: { rel: LinkRelations.MADE_BY_SENSOR.rel },
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

