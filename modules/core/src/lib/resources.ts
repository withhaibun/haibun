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
 * The speech act is expressed as the discourse edge predicate (a sub-property
 * of inReplyTo), not as a bare superproperty. Full Zod schema and domain
 * definition live at the bottom of this file — see `CommentSchema` and
 * `commentDomainDefinition`.
 */
export const COMMENT_LABEL = "Comment";
export const COMMENT_DOMAIN = "comment";

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
 * Discourse rels — each speech act is a sub-property of `inReplyTo`.
 * The discourse value IS the edge predicate: (comment, narrate, parent).
 * Materialized entailment: writing a discourse edge also writes inReplyTo.
 * Canonical set: measure, narrate, question, play, petition, grant, deny, invoke, revoke.
 */
export const DISCOURSE_RELS = ["measure", "narrate", "question", "play", "petition", "grant", "deny", "invoke", "revoke"] as const;
export type TDiscourseRel = (typeof DISCOURSE_RELS)[number];

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
 * Reply/conversation semantics are modeled by per-entry `subPropertyOf: "inReplyTo"`; ancestry checks walk the chain via `isSubPropertyOf`.
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

/**
 * Optional per-rel metadata. RDFS-aligned:
 *   subPropertyOf — names a parent rel; the rel inherits the parent's
 *                   semantics for ancestry walks (rdfs:subPropertyOf).
 *                   Single parent for now; relax to readonly array if a
 *                   rel needs multiple parents.
 *   label         — human-readable display name (rdfs:label). Renderers
 *                   show this in place of the raw rel string when set.
 *   icon          — visual badge for the rel. Rendered next to the label
 *                   in references / threads / discourse views.
 */

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
	WAS_INFORMED_BY: { rel: "wasInformedBy", uri: "prov:wasInformedBy", range: "iri", subPropertyOf: "inReplyTo" },
	INVALIDATED: { rel: "invalidated", uri: "prov:invalidated", range: "iri", subPropertyOf: "inReplyTo" },
	WAS_ASSOCIATED_WITH: { rel: "wasAssociatedWith", uri: "prov:wasAssociatedWith", range: "iri" },
	WAS_STARTED_BY: { rel: "wasStartedBy", uri: "prov:wasStartedBy", range: "iri", subPropertyOf: "inReplyTo" },
	STARTED_AT_TIME: { rel: "startedAtTime", uri: "prov:startedAtTime", range: "literal" },
	ENDED_AT_TIME: { rel: "endedAtTime", uri: "prov:endedAtTime", range: "literal" },
	// SOSA / W3C SSN — observation and sensing
	PHENOMENON_TIME: { rel: "phenomenonTime", uri: "sosa:phenomenonTime", range: "literal" },
	RESULT_TIME: { rel: "resultTime", uri: "sosa:resultTime", range: "literal" },
	HAS_RESULT: { rel: "hasResult", uri: "sosa:hasResult", range: "container" },
	MADE_BY_SENSOR: { rel: "madeBySensor", uri: "sosa:madeBySensor", range: "iri", subPropertyOf: "inReplyTo" },
	OBSERVED_PROPERTY: { rel: "observedProperty", uri: "sosa:observedProperty", range: "literal" },
	// schema.org — action outcomes
	SCHEMA_OBJECT: { rel: "schemaObject", uri: "schema:object", range: "literal" },
	SCHEMA_RESULT: { rel: "schemaResult", uri: "schema:result", range: "literal" },
	REPLACEE: { rel: "replacee", uri: "schema:replacee", range: "literal" },
	REPLACEMENT: { rel: "replacement", uri: "schema:replacement", range: "literal" },
	ACTION_STATUS: { rel: "actionStatus", uri: "schema:actionStatus", range: "literal" },
	PART_OF: { rel: "isPartOf", uri: "schema:isPartOf", range: "iri" },
	PRECEDED_BY: { rel: "precededBy", uri: "hbn:precededBy", range: "iri" },
	// Haibun native — discourse speech acts, each a sub-property of inReplyTo
	MEASURE: { rel: "measure", uri: "hbn:measure", range: "iri", subPropertyOf: "inReplyTo", label: "Measure", icon: "📊" },
	NARRATE: { rel: "narrate", uri: "hbn:narrate", range: "iri", subPropertyOf: "inReplyTo", label: "Narrate", icon: "💬" },
	QUESTION: { rel: "question", uri: "hbn:question", range: "iri", subPropertyOf: "inReplyTo", label: "Question", icon: "❓" },
	PLAY: { rel: "play", uri: "hbn:play", range: "iri", subPropertyOf: "inReplyTo", label: "Play", icon: "▶️" },
	PETITION: { rel: "petition", uri: "hbn:petition", range: "iri", subPropertyOf: "inReplyTo", label: "Petition", icon: "🙋" },
	GRANT: { rel: "grant", uri: "hbn:grant", range: "iri", subPropertyOf: "inReplyTo", label: "Grant", icon: "🪪" },
	DENY: { rel: "deny", uri: "hbn:deny", range: "iri", subPropertyOf: "inReplyTo", label: "Deny", icon: "⛔" },
	INVOKE: { rel: "invoke", uri: "hbn:invoke", range: "iri", subPropertyOf: "inReplyTo", label: "Invoke", icon: "⚡" },
	REVOKE: { rel: "revoke", uri: "hbn:revoke", range: "iri", subPropertyOf: "inReplyTo", label: "Revoke", icon: "↩️" },
	// Haibun native — other
	SEQ_PATH: { rel: "seqPath", uri: "hbn:seqPath", range: "iri" },
	HOST_ID: { rel: "hostId", uri: "hbn:hostId", range: "literal" },
	ACCESS_LEVEL: { rel: "accessLevel", uri: "hbn:accessLevel", range: "literal", presentation: "governance" as TRelPresentation },
	MEASUREMENT_KIND: { rel: "measurementKind", uri: "hbn:measurementKind", range: "literal" },
	SHAPE_DIGEST: { rel: "shapeDigest", uri: "hbn:shapeDigest", range: "container" },
	OUTCOME_REASON: { rel: "outcomeReason", uri: "hbn:outcomeReason", range: "literal" },
	// RDFS terminology — used by Property vertices to describe rels themselves.
	SUB_PROPERTY_OF: { rel: "subPropertyOf", uri: "rdfs:subPropertyOf", range: "iri" },
	LABEL: { rel: "label", uri: "rdfs:label", range: "literal" },
	RANGE: { rel: "range", uri: "rdfs:range", range: "literal" },
	ICON: { rel: "icon", uri: "hbn:icon", range: "literal" },
	PRESENTATION: { rel: "presentation", uri: "hbn:presentation", range: "literal" },
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

/** Lookup a rel's declared parent (rdfs:subPropertyOf), if any. */
function getSubPropertyOf(rel: string): string | undefined {
	for (const entry of Object.values(LinkRelations)) {
		if (entry.rel === rel) return (entry as { subPropertyOf?: string }).subPropertyOf;
	}
	return undefined;
}

/**
 * RDFS-style ancestry check: returns true if `rel` is `ancestorRel` or
 * transitively reaches it via `subPropertyOf` links. Generic — same
 * machinery serves any future rel hierarchy, not just reply semantics.
 * Cycle-guarded: a self-referential or looping `subPropertyOf` chain
 * terminates without recursing forever.
 */
export function isSubPropertyOf(rel: string, ancestorRel: string): boolean {
	const seen = new Set<string>();
	let current: string | undefined = rel;
	while (current && !seen.has(current)) {
		if (current === ancestorRel) return true;
		seen.add(current);
		current = getSubPropertyOf(current);
	}
	return false;
}

/**
 * Check if an edge type (predicate name or rel) is a reply-type link.
 * Resolves predicate names via EdgePredicates, then walks the
 * `subPropertyOf` chain to `inReplyTo`.
 */
export function isReplyEdge(edgeType: string): boolean {
	const target = LinkRelations.IN_REPLY_TO.rel;
	if (isSubPropertyOf(edgeType, target)) return true;
	const rel = edgeRel(edgeType);
	return rel ? isSubPropertyOf(rel, target) : false;
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
 * COMMENT_DOMAIN near the top of this file for the vocabulary consts.
 *
 * The speech act is expressed as the edge predicate (a discourse rel, sub-property
 * of inReplyTo), not a `discourse` property on the vertex.
 *
 * `author` stays an optional URI string at the storage layer (e.g.
 * "user:alice", "stepper:llm", "llm:gpt-x"). Legacy data may lack it.
 * Structured-Actor hydration is a query-time projection, not storage.
 */
export const CommentSchema = z.object({
	id: z.string(),
	author: z.string().optional(),
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
			timestamp: LinkRelations.PUBLISHED.rel,
			body: { rel: LinkRelations.CONTENT.rel, mediaType: "text/markdown" },
		},
		edges: {
			[HAS_BODY_EDGE]: { rel: LinkRelations.HAS_BODY.rel, range: BODY_LABEL },
			...Object.fromEntries(DISCOURSE_RELS.map((r) => [r, { rel: r, subPropertyOf: LinkRelations.IN_REPLY_TO.rel, range: COMMENT_LABEL }])),
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

// ============================================================================
// Property definitions — runtime projection of LinkRelations
// ============================================================================

/**
 * The runtime shape of a rel definition. `LinkRelations` is the canonical
 * declaration; this is its serialised projection — what travels on the wire
 * to the SPA so renderers can read label / icon / presentation / RDFS
 * ancestry without bundling the const itself. One source of truth, one
 * projection, no graph-stored copy that could diverge.
 */
export type TPropertyDefinition = {
	id: string;
	iri: string;
	range: TRelRange;
	label?: string;
	icon?: string;
	subPropertyOf?: string;
	presentation?: TRelPresentation;
};

/**
 * Project the `LinkRelations` const to a flat list of property definitions.
 * Pure derivation: every call produces the same data. Consumed by the
 * server's site-metadata builder; from there it reaches the SPA's rels
 * cache. The TS const stays canonical; this is its only runtime form.
 */
export function getPropertyDefinitions(): TPropertyDefinition[] {
	return Object.values(LinkRelations).map((entry) => {
		const record: TPropertyDefinition = { id: entry.rel, iri: entry.uri, range: entry.range };
		const extras = entry as { label?: string; icon?: string; subPropertyOf?: string; presentation?: TRelPresentation };
		if (extras.label !== undefined) record.label = extras.label;
		if (extras.icon !== undefined) record.icon = extras.icon;
		if (extras.subPropertyOf !== undefined) record.subPropertyOf = extras.subPropertyOf;
		if (extras.presentation !== undefined) record.presentation = extras.presentation;
		return record;
	});
}

