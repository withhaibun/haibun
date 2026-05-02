/**
 * Resources — the vocabulary and topology of things stored in a graph.
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
 *
 * Full Zod schema and domain definition live at the bottom of this file,
 * after TDomainDefinition is declared — see `CommentSchema` and
 * `commentDomainDefinition`.
 */
export const COMMENT_LABEL = "Comment";
export const COMMENT_DOMAIN = "comment";
export const COMMENT_EDGE = "commentsOn";

/** Body — opaque content (text, JSON, anything) typed by `mediaType`. */
export const BODY_LABEL = "Body";
export const BODY_DOMAIN = "body";
/** Edge from any resource to a Body sub-resource. */
export const HAS_BODY_EDGE = "hasBody";

/**
 * SeqPath — the hierarchical step identifier reified as a graph vertex.
 *
 * `featureStep.seqPath: number[]` is the per-execution hierarchical id
 * (e.g. [0,1,2,10] → "0.1.2.10"). Step dispatch emits SeqPath quads on
 * step entry/exit so any structured emission within a step's context can
 * link back to it via LinkRelations.SEQ_PATH.
 */
export const SEQ_PATH_LABEL = "SeqPath";

/** Status values for a SeqPath vertex's lifecycle. */
export const SEQ_PATH_STATUS = { running: "running", passed: "passed", failed: "failed" } as const;
export type SeqPathStatus = (typeof SEQ_PATH_STATUS)[keyof typeof SEQ_PATH_STATUS];

/**
 * Discourse — closed set of speech acts a Comment can perform.
 *
 * Every Comment carries a required discourse tag. The set is deliberately
 * small and closed; adding a value is a PR and requires a linked-data
 * mapping note.
 *
 *   suggest  — schema:SuggestAction; proposing a change
 *   measure  — narration of a sosa:Observation
 *   report   — schema:Report / as:Announce
 *   narrate  — prose narration (no standard mapping)
 *   question — schema:Question; asking for clarification
 *   apply    — narration of a schema:UpdateAction (the Development is the act)
 *   revert   — narration of a schema:UpdateAction undoing a prior apply
 *   play     — rehearsal or try-out; prov:Activity with no side effects
 */
export const DISCOURSE = {
	suggest: "suggest",
	measure: "measure",
	report: "report",
	narrate: "narrate",
	question: "question",
	apply: "apply",
	revert: "revert",
	play: "play",
	petition: "petition",
	grant: "grant",
	deny: "deny",
	invoke: "invoke",
	revoke: "revoke",
} as const;

/** Visual icon per discourse value. Renderers (e.g., the SHU SPA Comment view) prefix Comments with the icon. Avoids ✅/❌ which are reserved for step pass/fail. */
export const discourseIcon: Record<string, string> = {
	suggest: "💡",
	measure: "📊",
	report: "📝",
	narrate: "💬",
	question: "❓",
	apply: "🔧",
	revert: "⏪",
	play: "▶️",
	petition: "🙋",
	grant: "🪪",
	deny: "⛔",
	invoke: "⚡",
	revoke: "↩️",
};

const DISCOURSE_VALUES = Object.values(DISCOURSE) as [string, ...string[]];

export const DiscourseSchema = z.enum(DISCOURSE_VALUES, {
	message: `discourse must be one of ${DISCOURSE_VALUES.map((v) => `"${v}"`).join(", ")}`,
});

export type Discourse = z.infer<typeof DiscourseSchema>;

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
 * to let `linkRelFromSemantic` be a one-line lookup instead of a growing chain.
 *
 * Reply/conversation semantics are modeled by `REPLY_RELATIONS` below, not as per-entry metadata.
 */
export type TRelRange = "iri" | "literal" | "container";

/**
 * Where a property carrying this rel belongs in a resource's presentation. The
 * rel declares its bucket; renderers consume the bucket. Buckets describe
 * intent, not audience — every accessor (human, agent, LLM) gets all data;
 * the bucket only says where in the layout it goes.
 *   "summary"    — the resource's primary identification line (top of the card).
 *   "body"       — main content area; rendered as iframe / prose / structured body.
 *   "governance" — control rules about the resource (accessLevel, capability
 *                  bindings). Rendered in a labelled governance section, not
 *                  mixed into content fields.
 * Rels with no presentation default to the regular field table.
 */
export type TRelPresentation = "summary" | "body" | "governance";

export const LinkRelations = {
	NAME: { rel: "name", uri: "as:name", range: "literal", presentation: "summary" as TRelPresentation },
	PUBLISHED: { rel: "published", uri: "as:published", range: "literal" },
	ATTRIBUTED_TO: { rel: "attributedTo", uri: "as:attributedTo", range: "iri" },
	AUDIENCE: { rel: "audience", uri: "as:to", range: "iri" },
	CONTEXT: { rel: "groupedAs", uri: "as:context", range: "container" },
	UPDATED: { rel: "updated", uri: "as:updated", range: "literal" },
	CONTENT: { rel: "content", uri: "as:content", range: "literal", presentation: "body" as TRelPresentation },
	HAS_BODY: { rel: "hasBody", uri: "oa:hasBody", range: "iri", presentation: "body" as TRelPresentation },
	MEDIA_TYPE: { rel: "mediaType", uri: "as:mediaType", range: "literal" },
	IN_REPLY_TO: { rel: "inReplyTo", uri: "as:inReplyTo", range: "iri" },
	ATTACHMENT: { rel: "attachment", uri: "as:attachment", range: "iri" },
	TAG: { rel: "tag", uri: "as:tag", range: "literal" },
	IDENTIFIER: { rel: "identifier", uri: "dcterms:identifier", range: "iri" },
	URL: { rel: "url", uri: "as:url", range: "literal" },
	// PROV-O — provenance and lineage
	WAS_INFORMED_BY: { rel: "wasInformedBy", uri: "prov:wasInformedBy", range: "iri" },
	INVALIDATED: { rel: "invalidated", uri: "prov:invalidated", range: "iri" },
	WAS_ASSOCIATED_WITH: { rel: "wasAssociatedWith", uri: "prov:wasAssociatedWith", range: "iri" },
	WAS_STARTED_BY: { rel: "wasStartedBy", uri: "prov:wasStartedBy", range: "iri" },
	STARTED_AT_TIME: { rel: "startedAtTime", uri: "prov:startedAtTime", range: "literal" },
	ENDED_AT_TIME: { rel: "endedAtTime", uri: "prov:endedAtTime", range: "literal" },
	// SOSA / W3C SSN — observation and sensing
	PHENOMENON_TIME: { rel: "phenomenonTime", uri: "sosa:phenomenonTime", range: "literal" },
	RESULT_TIME: { rel: "resultTime", uri: "sosa:resultTime", range: "literal" },
	HAS_RESULT: { rel: "hasResult", uri: "sosa:hasResult", range: "container" },
	MADE_BY_SENSOR: { rel: "madeBySensor", uri: "sosa:madeBySensor", range: "iri" },
	OBSERVED_PROPERTY: { rel: "observedProperty", uri: "sosa:observedProperty", range: "literal" },
	// schema.org — action outcomes
	SCHEMA_OBJECT: { rel: "schemaObject", uri: "schema:object", range: "literal" },
	SCHEMA_RESULT: { rel: "schemaResult", uri: "schema:result", range: "literal" },
	REPLACEE: { rel: "replacee", uri: "schema:replacee", range: "literal" },
	REPLACEMENT: { rel: "replacement", uri: "schema:replacement", range: "literal" },
	ACTION_STATUS: { rel: "actionStatus", uri: "schema:actionStatus", range: "literal" },
	PART_OF: { rel: "isPartOf", uri: "schema:isPartOf", range: "iri" },
	PRECEDED_BY: { rel: "precededBy", uri: "hbn:precededBy", range: "iri" },
	// Haibun native — no existing vocabulary mapping
	DISCOURSE: { rel: "discourse", uri: "hbn:discourse", range: "literal" },
	SEQ_PATH: { rel: "seqPath", uri: "hbn:seqPath", range: "iri" },
	HOST_ID: { rel: "hostId", uri: "hbn:hostId", range: "literal" },
	ACCESS_LEVEL: { rel: "accessLevel", uri: "hbn:accessLevel", range: "literal", presentation: "governance" as TRelPresentation },
	MEASUREMENT_KIND: { rel: "measurementKind", uri: "hbn:measurementKind", range: "literal" },
	SHAPE_DIGEST: { rel: "shapeDigest", uri: "hbn:shapeDigest", range: "container" },
	OUTCOME_REASON: { rel: "outcomeReason", uri: "hbn:outcomeReason", range: "literal" },
} as const;

/** Lookup a rel's RDF range. Returns undefined for unknown rels. */
export function getRelRange(rel: string): TRelRange | undefined {
	for (const entry of Object.values(LinkRelations)) {
		if (entry.rel === rel) return entry.range;
	}
	return undefined;
}

/** Lookup a rel's presentation hint, if declared. Clients render `body` / `system` rels outside the default field-table path; everything else is a regular field cell. */
export function getRelPresentation(rel: string): TRelPresentation | undefined {
	for (const entry of Object.values(LinkRelations)) {
		if (entry.rel === rel) return (entry as { presentation?: TRelPresentation }).presentation;
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
	seqPath: { rel: LinkRelations.SEQ_PATH.rel },
	isPartOf: { rel: LinkRelations.PART_OF.rel },
	precededBy: { rel: LinkRelations.PRECEDED_BY.rel },
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

/** Rel values that represent reply/conversation semantics. */
const REPLY_RELATIONS: ReadonlySet<TRel> = new Set([
	LinkRelations.IN_REPLY_TO.rel,
	LinkRelations.WAS_INFORMED_BY.rel,
	LinkRelations.INVALIDATED.rel,
	LinkRelations.WAS_STARTED_BY.rel,
	LinkRelations.MADE_BY_SENSOR.rel,
]);

/** Check if a rel value is a reply-type (conversational/threading link). */
function isRelationRel(rel: string): boolean {
	return REPLY_RELATIONS.has(rel as TRel);
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

/**
 * Property definition. The plain-string form (`TRel`) declares a property's
 * rel and that's it. The object form is for content-shaped properties: it
 * declares the rel along with the Body sub-resource's media type (and an
 * optional discriminating `kind`). At upsert time, the writer partitions
 * such fields out of the parent into Body sub-resources linked via hasBody.
 *
 * The object form keeps each content field's declaration in one place,
 * matching the JSON-LD model where mediaType is data on the Body resource
 * itself rather than on the parent's stored state.
 *
 * `kind` distinguishes multiple bodies of the same media type on one parent
 * (e.g. a Proposal carrying both rationale and proposedAction in markdown).
 */
export type TContentPropertyDef = { rel: "content"; mediaType: string; kind?: string };

export type TPropertyDef = TRel | TContentPropertyDef;

export function isContentPropertyDef(def: TPropertyDef | undefined): def is TContentPropertyDef {
	return typeof def === "object" && def !== null && def.rel === "content";
}

/** Edge definition: target vertex type. The rel is resolved from EdgePredicates[key]; override with explicit rel for domain-specific edges not in the canonical set. */
export type TEdgeDef = { range: string; rel?: TRel };

/** Domain topology — vertex label, id field, property rels, edges, indexes. Drives CRUD, JSON-LD, and UI. */
export type TDomainTopology = {
	vertexLabel: string;
	type?: string;
	id: string;
	properties: Record<string, TPropertyDef>;
	edges?: Record<string, TEdgeDef>;
	/** Hypermedia affordance: properties that should be exposed as query filters/selects. */
	filterProperties?: string[];
	/** DB-specific: which properties to index for fast lookup. */
	propertyIndexes?: string[];
	/** DB-specific: default sort columns per property. */
	sortColumns?: Record<string, string>;
};


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
	/** UI metadata: slot, component, JS source, etc. Consumed by hypermedia renderers (e.g. SHU SPA). */
	ui?: Record<string, unknown>;
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
	ui?: Record<string, unknown>;
};

// ============================================================================
// Comment schema + domain definition
// ============================================================================

/**
 * Comment — free-text annotation attached to any Resource. See COMMENT_LABEL /
 * COMMENT_DOMAIN / COMMENT_EDGE near the top of this file for the vocabulary
 * consts.
 *
 * `discourse` tags the speech act (suggest, measure, report, narrate,
 * question, apply, revert, play). Closed enum in ./discourse.ts.
 *
 * `author` stays an optional URI string at the storage layer (e.g.
 * "user:alice", "stepper:llm", "llm:gpt-x"). Legacy data may lack it.
 * Structured-Actor hydration is a query-time projection, not storage.
 */
export const CommentSchema = z.object({
	id: z.string(),
	author: z.string().optional(),
	discourse: DiscourseSchema,
	timestamp: z.string(),
	body: z.string().optional(),
});

export type TComment = z.infer<typeof CommentSchema>;

/**
 * Comment domain definition — register this in a stepper's
 * `getConcerns().domains` to expose Comment as a first-class graph vertex.
 * Topology uses existing LinkRelations for every property; no new rels
 * introduced here.
 */
export const commentDomainDefinition: TDomainDefinition = {
	selectors: [COMMENT_DOMAIN],
	schema: CommentSchema,
	description: "Comment",
	topology: {
		vertexLabel: COMMENT_LABEL,
		id: "id",
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			author: LinkRelations.ATTRIBUTED_TO.rel,
			discourse: LinkRelations.DISCOURSE.rel,
			timestamp: LinkRelations.PUBLISHED.rel,
			body: { rel: LinkRelations.CONTENT.rel, mediaType: "text/markdown" },
		},
		filterProperties: ["discourse"],
		propertyIndexes: ["discourse"],
		edges: {
			[COMMENT_EDGE]: { rel: LinkRelations.IN_REPLY_TO.rel, range: RESOURCE_LABEL },
			[HAS_BODY_EDGE]: { rel: LinkRelations.HAS_BODY.rel, range: BODY_LABEL },
		},
	},
};

// ============================================================================
// Body schema + domain definition
// ============================================================================

/**
 * Body — opaque content with a declared media type. Linked from any resource
 * via `hasBody`. The canonical hypermedia shape: format is data on the Body,
 * not metadata on the parent resource's topology, so JSON-LD round-trips and
 * graph queries see mediaType as a first-class triple.
 */
export const BodySchema = z.object({
	id: z.string(),
	content: z.string(),
	mediaType: z.string(),
	createdAt: z.string(),
});

export type TBody = z.infer<typeof BodySchema>;

/**
 * Pick a body's content by media type from a vertex's `hasBody` projection.
 * Returns undefined if no body matches. Used by readers that consume content
 * after `getVertex` has inlined the linked Body sub-resources.
 */
export function bodyByMediaType(
	vertex: { hasBody?: Array<{ mediaType?: string; content?: string }> } | null | undefined,
	mediaType: string,
): string | undefined {
	return vertex?.hasBody?.find((b) => b.mediaType === mediaType)?.content;
}

export const bodyDomainDefinition: TDomainDefinition = {
	selectors: [BODY_DOMAIN],
	schema: BodySchema,
	description: "Opaque content keyed by mediaType (text/markdown, application/json, etc.)",
	topology: {
		vertexLabel: BODY_LABEL,
		id: "id",
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			content: LinkRelations.CONTENT.rel,
			mediaType: LinkRelations.MEDIA_TYPE.rel,
			createdAt: LinkRelations.PUBLISHED.rel,
		},
	},
};

