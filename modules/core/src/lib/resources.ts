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
 *   - TRel / TPropertyDef / TEdgeDef / TDomainTopology: the shape of a node-type declaration
 *   - TDomainDefinition / TRegisteredDomain: how steppers register a domain
 *   - Helpers: getRel, getMediaType, edgeRel, isReplyEdge
 *
 * Grounded in JSON-LD / ActivityStreams / RDF — node label is a local handle, `type` is the
 * RDF class URI that JSON-LD emits, `id` is the IRI.
 */
import { z } from "zod";

// ============================================================================
// Resource identity
// ============================================================================

/**
 * The universal shape of anything identifiable and typed.
 * `id` is the identifier (IRI in JSON-LD emission), `type` is the RDF class
 * (typically a compact IRI like "as:Document"; mapped to `@type` via JSON-LD context).
 *
 * Field naming follows W3C JSON-LD-based data models (unquoted `id`/`type`, as in ActivityStreams 2.0); the `@id`/`@type`
 * JSON-LD keywords are produced by the context at serialization time.
 */
export const ResourceSchema = z.object({
	id: z.string(),
	type: z.string(),
});
export type TResource = z.infer<typeof ResourceSchema>;

/** Root node label — any resource. Use as edge range when the target is polymorphic. */
export const RESOURCE_LABEL = "Resource";

/** haibun's canonical vocabulary namespace — the fallback base when no serving host is known, and the stem a consumer
 *  publishes a sub-vocabulary beneath. A served @context binds `hbn` under the request host instead. */
export const HAIBUN_NS = "https://withhaibun.github.io/ns/";
export const HAIBUN_NS_PATH = "/ns/";
/** The @context prefix bound to the haibun namespace. Any other prefix names a separate vocabulary, not haibun's. */
export const HAIBUN_PREFIXES = ["hbn"] as const;

/** The haibun namespace under a request origin (`https://192.168.1.9:8223` → `…/ns/`), or the canonical stem when
 *  host-less. Pass to getJsonLdContext's `haibunNs`. */
export function haibunNsForHost(baseOrigin?: string): string {
	return baseOrigin ? `${baseOrigin.replace(/\/+$/, "")}${HAIBUN_NS_PATH}` : HAIBUN_NS;
}

/**
 * A projected JSON-LD individual carries two keywords: `@id` (its IRI) and `@type` (its label).
 * `jsonLdIndividualOf` stamps them onto a domain schema for a single `@type` and rejects unexpected
 * fields, so a stepper's query/entity products are validated as strict JSON-LD nodes of a known type.
 */
export const jsonLdIndividualOf = (type: string, fields: z.ZodObject<z.ZodRawShape>) => fields.extend({ "@id": z.string(), "@type": z.literal(type) }).strict();

// ============================================================================
// Access levels
// ============================================================================

/**
 * Visibility policy for stored resources:
 *   - private: visible only to the resource's owner.
 *   - public: visible to everyone.
 *   - opened: private resource deliberately widened for audit; history preserves the prior state.
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

/** Web Annotation node labels — the target side of an annotation (a Comment anchored inside a source). Declared here so
 *  the Comment topology can carry a `linksTo` edge to a SpecificResource; the schemas + domain definitions are below. */
export const SPECIFIC_RESOURCE_LABEL = "SpecificResource";
export const TEXT_QUOTE_SELECTOR_LABEL = "TextQuoteSelector";

/** Body — opaque content (text, JSON, anything) typed by `mediaType`. */
export const BODY_LABEL = "Body";
export const BODY_DOMAIN = "body";
/** Edge from any resource to a Body sub-resource. */
export const HAS_BODY_EDGE = "hasBody";

/**
 * SeqPath — the hierarchical step identifier reified as a graph node.
 *
 * `featureStep.seqPath: number[]` is the per-execution hierarchical id
 * (e.g. [0,1,2,10] → "0.1.2.10"). Step dispatch emits SeqPath quads on
 * step entry/exit so any structured emission within a step's context can
 * link back to it via LinkRelations.SEQ_PATH.
 */
export const SEQ_PATH_LABEL = "SeqPath";

/** Status values for a SeqPath node's lifecycle. */
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
 * Link relation types — the canonical set of semantic rels for node properties and edges.
 * Declaration order determines column display priority in result tables.
 *
 * `range` is the RDF range of the predicate — what it points at:
 *   - "iri":       points at another resource (an IRI / node id). Renders as a navigable item.
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
 *                   Single parent.
 *   label         — human-readable display name (rdfs:label). Renderers
 *                   show this in place of the raw rel string when set.
 *   icon          — visual badge for the rel. Rendered next to the label
 *                   in references / threads / discourse views.
 */

export const LinkRelations = {
	NAME: { rel: "name", uri: "as:name", range: "literal", presentation: "summary" as TRelPresentation },
	PUBLISHED: { rel: "published", uri: "as:published", range: "literal", subPropertyOf: "ganttStart" },
	ATTRIBUTED_TO: { rel: "attributedTo", uri: "as:attributedTo", range: "iri", subPropertyOf: "fromActor", rolePriority: 10 },
	AUDIENCE: { rel: "audience", uri: "as:to", range: "iri" },
	CONTEXT: { rel: "groupedAs", uri: "as:context", range: "container" },
	UPDATED: { rel: "updated", uri: "as:updated", range: "literal" },
	CONTENT: { rel: "content", uri: "as:content", range: "literal", presentation: "body" as TRelPresentation },
	HAS_BODY: { rel: "hasBody", uri: "oa:hasBody", range: "iri", presentation: "body" as TRelPresentation },
	TARGET: { rel: "hasTarget", uri: "oa:hasTarget", range: "iri" },
	MEDIA_TYPE: { rel: "mediaType", uri: "as:mediaType", range: "literal" },
	IN_REPLY_TO: { rel: "inReplyTo", uri: "as:inReplyTo", range: "iri" },
	ATTACHMENT: { rel: "attachment", uri: "as:attachment", range: "iri" },
	TAG: { rel: "tag", uri: "as:tag", range: "literal" },
	IDENTIFIER: { rel: "identifier", uri: "dcterms:identifier", range: "iri" },
	URL: { rel: "url", uri: "as:url", range: "literal" },
	// schema.org — a work references an entity it names but is not about (schema:mentions). The edge a body-bearing
	// individual (an email, a document) draws to each person, place, organization, or other entity extracted from it.
	MENTIONS: { rel: "mentions", uri: "schema:mentions", range: "iri" },
	// W3C Web Annotation (oa:) — anchoring an annotation inside its source. An annotating Comment's hasTarget points at
	// an oa:SpecificResource, which names the whole document (hasSource) and the anchored segment (hasSelector → a
	// TextQuoteSelector whose exact/prefix/suffix quote the text, so the anchor survives re-import and re-rendering).
	HAS_SOURCE: { rel: "hasSource", uri: "oa:hasSource", range: "iri" },
	HAS_SELECTOR: { rel: "hasSelector", uri: "oa:hasSelector", range: "iri" },
	EXACT: { rel: "exact", uri: "oa:exact", range: "literal", presentation: "summary" as TRelPresentation },
	PREFIX: { rel: "prefix", uri: "oa:prefix", range: "literal" },
	SUFFIX: { rel: "suffix", uri: "oa:suffix", range: "literal" },
	// A linking annotation (oa:motivation oa:linking): the note anchored at one passage points at another spot in the
	// same source — a cross-reference. Modeled as an edge from the annotating Comment to the linked SpecificResource, so
	// a reader following the note jumps to the section it references.
	LINKS_TO: { rel: "linksTo", uri: "oa:hasBody", range: "iri" },
	// PROV-O — provenance and lineage
	// Entity → the responsible Agent (the party a node is attributed to, or its producing instance). The canonical
	// provenance attribution edge; a role attribution (subPropertyOf inRoleOf — the broad role super-property defined
	// below), so it is one of the predicates the fisheye's HypermediaRole grouping axis derives (see roleRels).
	WAS_ATTRIBUTED_TO: { rel: "wasAttributedTo", uri: "prov:wasAttributedTo", range: "iri", subPropertyOf: "fromActor", rolePriority: 20 },
	WAS_GENERATED_BY: { rel: "wasGeneratedBy", uri: "prov:wasGeneratedBy", range: "iri" },
	WAS_INFORMED_BY: { rel: "wasInformedBy", uri: "prov:wasInformedBy", range: "iri", subPropertyOf: "inReplyTo" },
	INVALIDATED: { rel: "invalidated", uri: "prov:invalidated", range: "iri", subPropertyOf: "inReplyTo" },
	WAS_ASSOCIATED_WITH: { rel: "wasAssociatedWith", uri: "prov:wasAssociatedWith", range: "iri" },
	WAS_STARTED_BY: { rel: "wasStartedBy", uri: "prov:wasStartedBy", range: "iri", subPropertyOf: "inReplyTo" },
	STARTED_AT_TIME: { rel: "startedAtTime", uri: "prov:startedAtTime", range: "literal", subPropertyOf: "ganttStart" },
	ENDED_AT_TIME: { rel: "endedAtTime", uri: "prov:endedAtTime", range: "literal", subPropertyOf: "ganttEnd" },
	// When the system generated this entity's representation — the required "when" field on every persisted object (distinct from as:published, which is the content's own time).
	GENERATED_AT_TIME: { rel: "generatedAtTime", uri: "prov:generatedAtTime", range: "literal" },
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
	// Scheduling / Gantt — task timing, effort, and dependencies. Concrete rels declare themselves under the gantt-*
	// upper concepts, so a paint recognises schedulable data via isSubPropertyOf regardless of which concrete
	// vocabulary (PROV, schema, hbn) supplied each field.
	GANTT_START: { rel: "ganttStart", uri: "hbn:ganttStart", range: "literal" },
	GANTT_END: { rel: "ganttEnd", uri: "hbn:ganttEnd", range: "literal" },
	GANTT_DURATION: { rel: "ganttDuration", uri: "hbn:ganttDuration", range: "literal" },
	GANTT_EFFORT: { rel: "ganttEffort", uri: "hbn:ganttEffort", range: "literal" },
	GANTT_DEPENDS: { rel: "ganttDepends", uri: "hbn:ganttDependsOn", range: "iri" },
	DURATION: { rel: "duration", uri: "schema:duration", range: "literal", subPropertyOf: "ganttDuration" },
	EFFORT: { rel: "effort", uri: "hbn:effort", range: "literal", subPropertyOf: "ganttEffort" },
	DEPENDS_ON: { rel: "dependsOn", uri: "hbn:dependsOn", range: "iri", subPropertyOf: "ganttDepends" },
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
	// RDFS terminology — used by Property nodes to describe rels themselves.
	SUB_PROPERTY_OF: { rel: "subPropertyOf", uri: "rdfs:subPropertyOf", range: "iri" },
	LABEL: { rel: "label", uri: "rdfs:label", range: "literal" },
	RANGE: { rel: "range", uri: "rdfs:range", range: "literal" },
	ICON: { rel: "icon", uri: "hbn:icon", range: "literal" },
	PRESENTATION: { rel: "presentation", uri: "hbn:presentation", range: "literal" },
	// W3C Security (sec:) — controllers, delegation, key material, proofs (DID + zcap-LD vocabulary)
	CONTROLLER: { rel: "controller", uri: "sec:controller", range: "iri" },
	DELEGATED_FROM: { rel: "delegatedFrom", uri: "sec:delegator", range: "iri" },
	ALLOWED_ACTION: { rel: "allowedAction", uri: "sec:allowedAction", range: "literal", presentation: "governance" as TRelPresentation },
	PUBLIC_KEY: { rel: "publicKey", uri: "sec:publicKeyMultibase", range: "literal" },
	EXPIRES: { rel: "expires", uri: "sec:expiration", range: "literal" },
	REVOKED: { rel: "revoked", uri: "sec:revoked", range: "literal", presentation: "governance" as TRelPresentation },
	PROOF: { rel: "proof", uri: "sec:proof", range: "iri" },
	// A record's validity window — general haibun-native terms (a permit, an offer, a certificate: anything can carry
	// one). A consumer whose standard names its own validity terms keeps these rels for behaviour and overrides the
	// served IRI per field (TTermPropertyDef).
	VALID_FROM: { rel: "validFrom", uri: "hbn:validFrom", range: "literal" },
	VALID_UNTIL: { rel: "validUntil", uri: "hbn:validUntil", range: "literal" },
	// Role attribution super-property — the BROAD term that gathers every predicate naming the party a node is attributed
	// to. Broader than prov:wasAttributedTo: a role target need not be a prov:Agent (an artifact published to a registry
	// groups under that REGISTRY, a publication target, not an agent), so prov:wasAttributedTo is itself a SUB-property
	// of this rather than the other way round. The role grouping axis derives its predicate set as "every rel declared
	// subPropertyOf inRoleOf" (roleRels below) plus every consumer edge declared with an actor rel — ontology-driven,
	// never a hand-kept array.
	IN_ROLE_OF: { rel: "inRoleOf", uri: "hbn:inRoleOf", range: "iri", abstract: true },
	// Directional actor super-properties under inRoleOf — the ORIENTATION the grouping axis doesn't need but a sequence
	// does. fromActor = the source/origin actor an entity is FROM (its creator/sender/responsible agent); toActor = the
	// destination/audience actor it is TO (its subject/recipient/registry). Both subPropertyOf inRoleOf, so every concrete
	// actor rel that declares under one is STILL a role rel (roleRels derives transitively) — the split only ADDS direction,
	// it removes nothing. An Actor is a prov:Agent ≡ as:Actor ≡ foaf:Agent. Generic across vocabularies: a sequence reads
	// any entity carrying a fromActor AND a toActor as a message source→target, with no per-type knowledge.
	// Abstract — never a written edge label, only a classification target (like inRoleOf). These are the UPPER ONTOLOGY
	// POINTERS a consumer's domain declaration uses: an edge declared `{ rel: "fromActor", iri: "<its own term>" }`
	// classifies under the pointer while serving its genuine vocabulary IRI, so consumer vocabularies never appear here.
	FROM_ACTOR: { rel: "fromActor", uri: "hbn:fromActor", range: "iri", subPropertyOf: "inRoleOf", abstract: true },
	TO_ACTOR: { rel: "toActor", uri: "hbn:toActor", range: "iri", subPropertyOf: "inRoleOf", abstract: true },
	// Concrete general actor rels. The graph edge LABEL a stepper writes IS the rel string (the role fold matches the
	// quad predicate = the edge label). Each declares its DIRECTION (fromActor = source, toActor = destination) and its
	// rolePriority — when a node carries several role edges, the highest-priority one names its container/lane (a VIEW
	// ordering shared with consumer-declared edges, which carry their own rolePriority in their domain declarations).
	PERFORMED_BY: { rel: "performedBy", uri: "prov:wasAssociatedWith", range: "iri", subPropertyOf: "fromActor", rolePriority: 40 },
	AUTHOR: { rel: "author", uri: "schema:author", range: "iri", subPropertyOf: "fromActor", rolePriority: 30 },
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
export const REL_CONTEXT: Record<TRel, string> = Object.fromEntries(Object.values(LinkRelations).map(({ rel, uri }) => [rel, uri])) as Record<TRel, string>;

/**
 * Standard edge predicates for graph nodes.
 * Each carries its LinkRelation rel — the single source of truth for predicate→rel resolution.
 * Steppers use these as edge keys in getConcerns().edges and in createEdge() calls.
 */
export const EdgePredicates = {
	from: { rel: LinkRelations.ATTRIBUTED_TO.rel },
	to: { rel: LinkRelations.AUDIENCE.rel },
	cc: { rel: LinkRelations.AUDIENCE.rel },
	author: { rel: LinkRelations.ATTRIBUTED_TO.rel },
	attachment: { rel: LinkRelations.ATTACHMENT.rel },
	hasTarget: { rel: LinkRelations.TARGET.rel },
	inReplyTo: { rel: LinkRelations.IN_REPLY_TO.rel },
	references: { rel: LinkRelations.CONTEXT.rel },
	endpoint: { rel: LinkRelations.URL.rel },
	wasInformedBy: { rel: LinkRelations.WAS_INFORMED_BY.rel },
	invalidated: { rel: LinkRelations.INVALIDATED.rel },
	madeBySensor: { rel: LinkRelations.MADE_BY_SENSOR.rel },
	seqPath: { rel: LinkRelations.SEQ_PATH.rel },
	isPartOf: { rel: LinkRelations.PART_OF.rel },
	precededBy: { rel: LinkRelations.PRECEDED_BY.rel },
	controller: { rel: LinkRelations.CONTROLLER.rel },
	delegatedFrom: { rel: LinkRelations.DELEGATED_FROM.rel },
	hasBody: { rel: LinkRelations.HAS_BODY.rel },
	mentions: { rel: LinkRelations.MENTIONS.rel },
	hasSource: { rel: LinkRelations.HAS_SOURCE.rel },
	hasSelector: { rel: LinkRelations.HAS_SELECTOR.rel },
	linksTo: { rel: LinkRelations.LINKS_TO.rel },
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

/** A rel's declared parents (rdfs:subPropertyOf). A rel may sit under MORE THAN ONE upper concept, so this is a set:
 *  `subPropertyOf` accepts a single rel or an array, and both forms normalise to a list here. Empty when none declared. */
function superPropertiesOf(rel: string): string[] {
	for (const entry of Object.values(LinkRelations)) {
		if (entry.rel === rel) {
			const sp = (entry as { subPropertyOf?: string | string[] }).subPropertyOf;
			return sp === undefined ? [] : Array.isArray(sp) ? sp : [sp];
		}
	}
	return [];
}

/**
 * RDFS-style ancestry check: returns true if `rel` is `ancestorRel` or transitively reaches it via `subPropertyOf`
 * links. `subPropertyOf` is many-valued (a rel can be a sub-property of several upper concepts at once — e.g. a
 * start-date rel that is both a temporal instant AND a gantt-start), so this walks the parent DAG, not a single chain.
 * Generic — the same machinery serves any rel hierarchy, not just reply semantics. Cycle-guarded: a self-referential
 * or looping `subPropertyOf` graph terminates without recursing forever.
 */
export function isSubPropertyOf(rel: string, ancestorRel: string): boolean {
	const seen = new Set<string>();
	const stack: string[] = [rel];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined || seen.has(current)) continue;
		if (current === ancestorRel) return true;
		seen.add(current);
		stack.push(...superPropertiesOf(current));
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

/**
 * The ontology-derived ROLE-ATTRIBUTION predicate set: every CORE rel declared `subPropertyOf` the broad role
 * super-property `inRoleOf` (performedBy, author, wasAttributedTo, attributedTo, …). Declaring a new core role
 * predicate is a single `subPropertyOf: "inRoleOf"` in LinkRelations, with NOTHING to add here; a CONSUMER's role
 * predicates never appear here — they classify through their domain declarations' edges (rel = an actor upper pointer),
 * merged with this set by the client's rels-cache. The role fold reads the merged set to fold each node's
 * HypermediaRole (the party it is attributed to) and to form the role containers / swimlanes.
 *
 * The set is UNORDERED (a Set); priority for a node carrying several role edges rides each entry's declared rolePriority.
 * `inRoleOf` itself is excluded — it is the abstract super-property, never a written edge label.
 */
/** The concrete (non-abstract) rels transitively `subPropertyOf` `target` — the ontology-derived predicate set for an
 *  upper concept. Abstract concepts (inRoleOf, fromActor, toActor) are excluded: they classify, they are never a written
 *  edge label. The shared kernel for roleRels / fromActorRels / toActorRels. */
function concreteSubRelsOf(target: string): ReadonlySet<string> {
	const set = new Set<string>();
	for (const entry of Object.values(LinkRelations)) {
		if ((entry as { abstract?: boolean }).abstract) continue;
		if (isSubPropertyOf(entry.rel, target)) set.add(entry.rel);
	}
	return set;
}

export function roleRels(): ReadonlySet<string> {
	return concreteSubRelsOf(LinkRelations.IN_ROLE_OF.rel);
}

/** The SOURCE-side actor rels (issuer/holder/author/performedBy/attributedTo/wasAttributedTo) — every concrete rel under
 *  `fromActor`. A sequence reads an entity's fromActor as the lifeline it originates from. */
export function fromActorRels(): ReadonlySet<string> {
	return concreteSubRelsOf(LinkRelations.FROM_ACTOR.rel);
}

/** The TARGET-side actor rels — every concrete CORE rel under `toActor` (consumer edges classify via their domain
 *  declarations). A sequence reads an entity's toActor as the lifeline a message is directed to. */
export function toActorRels(): ReadonlySet<string> {
	return concreteSubRelsOf(LinkRelations.TO_ACTOR.rel);
}

// ============================================================================
// Hypermedia topology: how a stepper declares a persisted type
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

/**
 * A property whose genuine vocabulary IRI is not its rel's default. The rel still drives behaviour (sort, facet,
 * presentation), but the served `@context` maps the field to `iri` — so a standards-conformant field carries its real
 * term (e.g. a consumer field `dueDate` → `ex:dueDate` under the consumer's declared prefix) instead of the placeholder
 * IRI a catch-all rel would give it. `iri` is a CURIE whose prefix the context declares (topology.namespaces).
 */
export type TTermPropertyDef = { rel: TRel; iri: string };

export type TPropertyDef = TRel | TContentPropertyDef | TTermPropertyDef;

export function isContentPropertyDef(def: TPropertyDef | undefined): def is TContentPropertyDef {
	return typeof def === "object" && def !== null && def.rel === "content";
}

/** The genuine vocabulary IRI a property declares (TTermPropertyDef), if any — else undefined (its rel's IRI is used). */
export function propertyIriOf(def: TPropertyDef | undefined): string | undefined {
	return typeof def === "object" && def !== null && "iri" in def ? def.iri : undefined;
}

/** Edge definition: target node type. The rel is resolved from EdgePredicates[key]; override with explicit rel for
 *  domain-specific edges not in the canonical set. A consumer vocabulary's edge declares an UPPER ONTOLOGY POINTER as
 *  its rel (e.g. `fromActor`/`toActor`) with `iri` carrying its genuine term — the edge KEY is the written edge label,
 *  the rel classifies it, the iri serves it. `rolePriority` orders actor edges when a node carries several (highest
 *  names its container/lane) — same scale as the core rels' declared rolePriority. */
export type TEdgeDef = { range: string; rel?: TRel; iri?: string; rolePriority?: number; label?: string };

/**
 * Per-property domain ranges. Maps a schema field name to another registered
 * domain key, declaring "values of this field range over instances of that
 * domain." This is the haibun equivalent of SHACL's `sh:node` / RDFS's
 * `rdfs:range` — a structural claim about what kind of thing a property
 * carries, read by the goal resolver to decompose composite inputs into their
 * typed component goals and by the chain view to emit field nodes.
 *
 * Distinct from `THypermediaTopology.edges`: edges declare outgoing graph edges
 * keyed by predicate name (with their own rel + range); ranges annotate the
 * scalar / nested-object schema fields already enumerated in `properties`
 * with their declared domain. A field with no ranges entry is treated as
 * primitive by the resolver (resolves to an `argument` binding).
 */
export type TDomainRanges = Record<string, string>;

/**
 * Hypermedia topology — fully describes a persisted domain. Required together:
 * `persistedAs`, `id`, `properties`. The hypermedia builder validates these
 * (presence of an identifier rel, a published rel, etc.).
 */
export type THypermediaTopology = {
	persistedAs: string;
	type?: string;
	/**
	 * @context prefix→IRI bindings this type's own vocabulary needs, for any prefix beyond the standards and haibun's own
	 * that core declares. A consumer whose @type or rel IRI uses `foo:Bar` declares `foo` here; getJsonLdContext merges it
	 * into the served context.
	 */
	namespaces?: Record<string, string>;
	/**
	 * The published standard @context(s) this type conforms to (absolute URLs of the standard's context document). The served
	 * type-scoped @context references them as a JSON-LD 1.1 array (URLs first, this type's own field terms last so haibun's
	 * definitions win on any collision), so the type's full standard vocabulary is expressible; the schema-graph projection
	 * enumerates their terms to show every property a conforming instance may carry, marking which are absent from the data.
	 */
	standardContexts?: string[];
	/**
	 * rdfs:subClassOf — superclass IRI(s) this type is a kind of, emitted into the served JSON-LD
	 * `@context` so the type's class entails them. The single-string `@type` carries only the bare
	 * label (one navigable type), so a second standards class a node must satisfy — e.g. a `sec:Issuer`
	 * or `sec:Controller` that is the target of `prov:wasAttributedTo` (range `prov:Agent`) — is asserted
	 * here as the genuine RDFS axiom rather than by multi-valuing `@type`.
	 */
	subClassOf?: string | string[];
	id: string;
	properties: Record<string, TPropertyDef>;
	edges?: Record<string, TEdgeDef>;
	/** Per-property ranges (sh:node / rdfs:range). See TDomainRanges. */
	ranges?: TDomainRanges;
	/** Hypermedia affordance: properties that should be exposed as query filters/selects. */
	filterProperties?: string[];
	/** DB-specific: which properties to index for fast lookup. */
	propertyIndexes?: string[];
	/** DB-specific: default sort columns per property. */
	sortColumns?: Record<string, string>;
	/** Default sort field when a query specifies none. Must be one of this type's sort columns. Declare it for a type whose meaningful event/content time differs from its record-creation time (e.g. an email's received time vs its import time); otherwise the universal generatedAtTime is used. */
	defaultSort?: string;
	/**
	 * The property type (rel) whose value titles this type — its vocabulary's labeling property, the way foaf:name or
	 * dcterms:title labels its own type. Declare it for a type that says what it is through a term of its own vocabulary
	 * rather than the cross-domain rdfs:label / as:name / content that `DISPLAY_LABEL_HEADLINE` resolves: an
	 * oa:TextQuoteSelector is the passage it quotes (oa:exact), not a thing with a name.
	 *
	 * Must be a rel this type declares, as a property OR an edge — the rel's own range decides how it resolves, so both
	 * are the same declaration: a literal-ranged rel (oa:exact) carries the label text; an iri-ranged one (oa:hasSelector)
	 * points at the individual whose label this type takes, which is how a proxy standing for another resource is titled.
	 * An explicit rdfs:label on an individual still wins — this is the type's title, not an override of the reader's.
	 */
	displayLabel?: TRel;
};

/**
 * Lightweight topology for non-persisted domains — schemas that aren't themselves
 * persisted but whose fields range over registered persisted domains (typical for
 * step *input* composite shapes). Carries only `ranges`; the hypermedia
 * builder skips it; only the resolver reads it.
 */
export type TRangesTopology = {
	ranges: TDomainRanges;
};

/**
 * Domain topology — discriminated union of full hypermedia topology and a
 * lightweight ranges-only declaration. A topology must be one or the other;
 * mixing partial persisted fields without a persistedAs is structurally invalid
 * and the type system rejects it.
 */
export type TDomainTopology = THypermediaTopology | TRangesTopology;

/** True when a domain's topology marks it as persisted (presence of persistedAs). */
export function isPersisted(topology: TDomainTopology | undefined): topology is THypermediaTopology {
	return !!topology && "persistedAs" in topology && typeof topology.persistedAs === "string";
}

/** Domain name for type labels — auto-populated from registered persisted domains. */
export const DOMAIN_PERSISTED_TYPE = "persisted-type";

// ============================================================================
// Domain registration shape
// ============================================================================

/** Coercion function: parse a step value (or other proto) into the domain's native representation. */
export type TDomainCoercer = (
	proto: import("../schema/protocol.js").TStepValue,
	featureStep?: import("./astepper.js").TFeatureStep,
	steppers?: import("./astepper.js").AStepper[],
) => import("../schema/protocol.js").TStepValueValue;

/** Comparator between two coerced domain values. */
export type TDomainComparator = (value: import("../schema/protocol.js").TStepValueValue, baseline: import("../schema/protocol.js").TStepValueValue) => number;

export type TDomainDefinition = {
	selectors: string[];
	schema: z.ZodType;
	coerce?: TDomainCoercer;
	comparator?: TDomainComparator;
	values?: string[];
	description: string;
	/** Stepper that registered this domain (set automatically by registerDomains) */
	stepperName?: string;
	/** Hypermedia topology — label, id, property rels, edges, indexes. Undefined for non-persisted domains. */
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
	description: string;
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
 * of inReplyTo), not a `discourse` property on the node.
 *
 * `author` identifies who made the comment — a required URI string (e.g.
 * "user:alice", "stepper:llm", "llm:gpt-x"); every Comment is attributed.
 * Structured-Actor hydration is a query-time projection, not storage.
 */
// Persisted schemas accept passthrough fields: callers attach edge-construction
// rels (`discourse`, `inReplyTo`, …) that upsertIndividual's partition step
// routes to edges rather than to the individual properties. Strict mode would
// reject those before the partition can run.
export const CommentSchema = z.object({
	id: z.string(),
	author: z.string(),
	generatedAtTime: z.string(),
	/** The start of the period the note is ABOUT (a milestone's week, a summarized span) — subject time, distinct from
	 *  `generatedAtTime`, which stays the moment the record was written. Time-placed views (gantt) read this. */
	startedAtTime: z.string().optional(),
	/** The end of the period the note is about. With `startedAtTime`, time-placed views read the note as an interval;
	 *  a start without an end reads as an instant milestone. */
	endedAtTime: z.string().optional(),
	seqPath: z.string().optional(),
	body: z.string().optional(),
	/** A short display name — the note's own text (truncated). The body is partitioned into a Body sub-resource, so
	 *  without this a Comment node would title by its id; `name` lets a graph view show what the note says. */
	name: z.string().optional(),
});

export type TComment = z.infer<typeof CommentSchema>;

/**
 * Comment domain definition — register this in a stepper's
 * `getConcerns().domains` to expose Comment as a first-class graph node.
 * Topology uses existing LinkRelations for every property; no new rels
 * introduced here.
 */
export const commentDomainDefinition: TDomainDefinition = {
	selectors: [COMMENT_DOMAIN],
	schema: CommentSchema,
	description: "A note about another record. It links to what it is about and to any replies, so conversations stay attached to their subject.",
	topology: {
		persistedAs: COMMENT_LABEL,
		// A Comment carries oa:hasBody and oa:hasTarget — the W3C Web Annotation shape — so the class relationship is
		// asserted as a genuine RDFS axiom rather than by multi-valuing @type.
		subClassOf: "oa:Annotation",
		id: "id",
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			name: LinkRelations.NAME.rel,
			author: LinkRelations.ATTRIBUTED_TO.rel,
			generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
			startedAtTime: LinkRelations.STARTED_AT_TIME.rel,
			endedAtTime: LinkRelations.ENDED_AT_TIME.rel,
			seqPath: LinkRelations.SEQ_PATH.rel,
			body: { rel: LinkRelations.CONTENT.rel, mediaType: "text/markdown" },
		},
		edges: {
			[HAS_BODY_EDGE]: { rel: LinkRelations.HAS_BODY.rel, range: BODY_LABEL },
			// What the comment is about — any Resource (an entity, or another Comment in a thread).
			[LinkRelations.TARGET.rel]: { rel: LinkRelations.TARGET.rel, range: RESOURCE_LABEL },
			// A linking annotation's cross-reference: the note points at another SpecificResource (a section) in the source.
			[LinkRelations.LINKS_TO.rel]: { rel: LinkRelations.LINKS_TO.rel, range: SPECIFIC_RESOURCE_LABEL },
			...Object.fromEntries(DISCOURSE_RELS.map((r) => [r, { rel: r, subPropertyOf: LinkRelations.IN_REPLY_TO.rel, range: COMMENT_LABEL }])),
		},
		sortColumns: { author: "TEXT", seqPath: "TEXT" },
	},
};

// ============================================================================
// Principal schema + domain definition
// ============================================================================

/**
 * Principal — a standards-based identity in the graph (W3C DID + Security `sec:`
 * vocabulary + zcap-LD delegation semantics). The acting identity (a Comment's
 * `author`, an artifact's creator) is a DID string; a Principal node is its
 * persisted, public descriptor.
 *
 * Two kinds persist: the root site principal (self-issued — `controller === id`,
 * no delegation) and explicit `issue subkey` delegations (linked to the delegating
 * principal by a single navigable `delegatedFrom` AGE edge, `allowedAction` = the
 * delegated actions). Ephemeral `as subkey` / `with token` activations do NOT persist a
 * Principal. Delegation is an edge, not a scalar field — so it never appears in
 * PrincipalSchema; `persistPrincipalIndividual` writes the lone `delegatedFrom` edge.
 *
 * Comment→Principal authorship is by SHARED DID, not an edge: `Comment.author`
 * (a string) equals the subkey/site `Principal.id`, resolvable via
 * `getIndividual("Principal", comment.author)`.
 *
 * Only PUBLIC material persists — there is no private-key field, by design.
 */
export const PRINCIPAL_LABEL = "Principal";
/** Domain selector — distinct from the runtime "principal" key (see lib/principal.ts) to avoid collision. */
export const PRINCIPAL_DOMAIN = "principal-individual";

export const PrincipalSchema = z.object({
	id: z.string(),
	/** as:name — an optional human name for this Principal (a DID has none intrinsically). Lets a party be titled by a readable name instead of its DID; resolves as the display headline (rdfs:label → as:name priority). Named `name`, not `label`, so it is a queryable column: `label` is an AGE-reserved column name. */
	name: z.string().optional(),
	controller: z.string().optional(),
	allowedAction: z.string().optional(),
	publicKey: z.string().optional(),
	generatedAtTime: z.string(),
	expires: z.string().optional(),
	revoked: z.boolean().optional(),
	proof: z.string().optional(),
});

export type TPrincipal = z.infer<typeof PrincipalSchema>;

/**
 * Principal domain definition — register in a stepper's `getConcerns().domains`
 * to expose Principal as a first-class graph node. `generatedAtTime` is REQUIRED on
 * purpose: buildConcernCatalog (hypermedia.ts) rejects a persisted domain whose
 * GENERATED_AT_TIME-rel field is optional.
 *
 * Delegation is the lone topology edge, `delegatedFrom` (sec:delegator), ranging
 * over the delegating Principal — one navigable AGE edge per subkey, written by
 * `persistPrincipalIndividual`. `controller` is a plain property: in every persist path
 * `controller === id` (a Principal controls itself), so a self-referential edge
 * draws nothing useful; it stays a scalar in `properties` + `sortColumns`.
 */
export const principalDomainDefinition: TDomainDefinition = {
	selectors: [PRINCIPAL_DOMAIN],
	schema: PrincipalSchema,
	// THE definition of a DID for a reader: a Principal's identity IS one, so this is where the term is explained, and
	// every other description links the word here rather than explaining it again.
	description:
		"A person or service that acts in this system — the author behind records, comments, and decisions. Each is identified by a DID: a decentralized identifier, a stable web address of its own (written did:…) that anyone can look up to find the keys it signs with, so no central directory decides who is who.",
	topology: {
		persistedAs: PRINCIPAL_LABEL,
		type: "sec:Controller",
		// A Principal IS the responsible agent every persisted node is attributed to (prov:wasAttributedTo, range prov:Agent);
		// declare sec:Controller a kind of prov:Agent so that attribution is well-formed against the rel's range.
		subClassOf: "prov:Agent",
		id: "id",
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			name: LinkRelations.NAME.rel,
			controller: LinkRelations.CONTROLLER.rel,
			allowedAction: LinkRelations.ALLOWED_ACTION.rel,
			publicKey: LinkRelations.PUBLIC_KEY.rel,
			generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
			expires: LinkRelations.EXPIRES.rel,
			revoked: LinkRelations.REVOKED.rel,
		},
		edges: {
			delegatedFrom: { rel: LinkRelations.DELEGATED_FROM.rel, range: PRINCIPAL_LABEL },
		},
		sortColumns: { name: "TEXT", controller: "TEXT", generatedAtTime: "TIMESTAMPTZ", revoked: "BOOLEAN" },
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
// Body schema same constraint as Comment: parent nodes supply content
// fields that the partition step extracts before persistence.
export const BodySchema = z.object({
	id: z.string(),
	content: z.string(),
	mediaType: z.string(),
	generatedAtTime: z.string(),
});

export type TBody = z.infer<typeof BodySchema>;

/** The least a caller needs to read one body: fetch that Body individual. */
type TBodyReader = { getIndividual(label: string, id: string): Promise<unknown> };

/**
 * Read the text of an individual's body in a given media type — the intentional call for it. A record NAMES the bodies
 * it links (id + media type) but never carries their text, since a body is a whole record's content and may be very
 * large; so the matching body is read here, by asking for it. Undefined when the individual links no such body.
 */
export async function bodyByMediaType(
	store: TBodyReader,
	individual: { hasBody?: Array<{ id?: string; mediaType?: string }> } | null | undefined,
	mediaType: string,
): Promise<string | undefined> {
	const bodyId = individual?.hasBody?.find((b) => b.mediaType === mediaType)?.id;
	if (!bodyId) return undefined;
	const body = (await store.getIndividual(BODY_LABEL, String(bodyId))) as { content?: string } | null;
	return body?.content;
}

export const bodyDomainDefinition: TDomainDefinition = {
	selectors: [BODY_DOMAIN],
	schema: BodySchema,
	description: "The full content of another record — a message's text, a document's data — stored alongside it so large content loads only when opened.",
	topology: {
		persistedAs: BODY_LABEL,
		id: "id",
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			content: LinkRelations.CONTENT.rel,
			mediaType: LinkRelations.MEDIA_TYPE.rel,
			generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
		},
		// Declared query surface for the one-path graph-store: callers can filter
		// or sort Body rows by mediaType (e.g. "all PDF bodies") or generatedAtTime.
		sortColumns: { mediaType: "TEXT", generatedAtTime: "TIMESTAMPTZ" },
	},
};

// ============================================================================
// Web Annotation target schemas + domain definitions (W3C Web Annotation Data Model)
// ============================================================================

/**
 * TextQuoteSelector — locates a segment of a source document by quoting it (oa:exact),
 * optionally disambiguated by the text immediately before (oa:prefix) and after
 * (oa:suffix). Content-anchored: the anchor survives re-import and re-rendering
 * of the source, which byte offsets would not.
 */
export const TEXT_QUOTE_SELECTOR_DOMAIN = "text-quote-selector";

export const TextQuoteSelectorSchema = z.object({
	id: z.string(),
	exact: z.string(),
	prefix: z.string().optional(),
	suffix: z.string().optional(),
	generatedAtTime: z.string(),
});
export type TTextQuoteSelector = z.infer<typeof TextQuoteSelectorSchema>;

export const textQuoteSelectorDomainDefinition: TDomainDefinition = {
	selectors: [TEXT_QUOTE_SELECTOR_DOMAIN],
	schema: TextQuoteSelectorSchema,
	description: "The quoted text that pins an annotation to one spot inside a document, with optional surrounding text to make the match unambiguous.",
	topology: {
		persistedAs: TEXT_QUOTE_SELECTOR_LABEL,
		type: "oa:TextQuoteSelector",
		id: "id",
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			exact: LinkRelations.EXACT.rel,
			prefix: LinkRelations.PREFIX.rel,
			suffix: LinkRelations.SUFFIX.rel,
			generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
		},
		// Named as the labeling property, never remapped to CONTENT.rel: the selector has no content, and asserting the
		// quote as its content would serialize a false claim.
		displayLabel: LinkRelations.EXACT.rel,
		sortColumns: { exact: "TEXT" },
	},
};

/**
 * SpecificResource — the part of a document an annotation is about (W3C Web Annotation
 * "Specific Resource"): oa:hasSource names the whole document, oa:hasSelector the segment.
 * An annotating Comment's oa:hasTarget points here instead of at the whole document, so
 * the document itself is never edited — annotations attach from outside, and a view
 * resolves the selector against the document's content when rendering.
 *
 * Carries no property of its own to be titled by, which is what the model says it is: a proxy standing for a passage,
 * serialized inline and dereferenced by no one. Its subject id is a minted storage artifact rather than identity, so it
 * is titled through oa:hasSelector by the passage its selector locates — see `displayLabel` below. It takes no name of
 * its own: the model gives oa:SpecificResource none.
 */
export const SPECIFIC_RESOURCE_DOMAIN = "specific-resource";

export const SpecificResourceSchema = z.object({
	id: z.string(),
	generatedAtTime: z.string(),
});
export type TSpecificResource = z.infer<typeof SpecificResourceSchema>;

export const specificResourceDomainDefinition: TDomainDefinition = {
	selectors: [SPECIFIC_RESOURCE_DOMAIN],
	schema: SpecificResourceSchema,
	description: "A spot inside a document — the document plus the selection that locates the spot — so a note can point at one passage instead of the whole document.",
	topology: {
		persistedAs: SPECIFIC_RESOURCE_LABEL,
		type: "oa:SpecificResource",
		id: "id",
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
		},
		edges: {
			hasSource: { rel: LinkRelations.HAS_SOURCE.rel, range: RESOURCE_LABEL },
			hasSelector: { rel: LinkRelations.HAS_SELECTOR.rel, range: TEXT_QUOTE_SELECTOR_LABEL },
		},
		// Titled through its selector: the proxy carries no property of its own a reader could be shown.
		displayLabel: LinkRelations.HAS_SELECTOR.rel,
	},
};

/** Which side of an annotated quote its context sits on: "preceded by" makes the context the TextQuoteSelector prefix,
 *  "followed by" the suffix — so a short or repeated quote resolves to the intended occurrence. */
export const ANNOTATION_PLACEMENT_DOMAIN = "annotation-placement";
export const AnnotationPlacementSchema = z.enum(["preceded by", "followed by"]);
export type TAnnotationPlacement = z.infer<typeof AnnotationPlacementSchema>;
export const annotationPlacementDomainDefinition: TDomainDefinition = {
	selectors: [ANNOTATION_PLACEMENT_DOMAIN],
	schema: AnnotationPlacementSchema,
	description: "Which side of an annotated quote its context sits on: preceded by (the prefix) or followed by (the suffix).",
};

export const ANNOTATION_NOTE_DOMAIN = "annotation-note";
const AnnotationQuoteSchema = z.object({
	exact: z.string().describe("The verbatim passage the note (or one of its links) anchors to."),
	prefix: z.string().optional().describe("Verbatim text immediately before the passage, disambiguating a repeated quote."),
	suffix: z.string().optional().describe("Verbatim text immediately after the passage, disambiguating a repeated quote."),
});
export const AnnotationNoteSchema = z
	.object({
		label: z.string().describe("The persisted type of the annotated individual."),
		id: z.string().describe("The annotated individual's id."),
		exact: z.string(),
		prefix: z.string().optional(),
		suffix: z.string().optional(),
		text: z.string().describe("The note's body."),
		at: z.string().optional().describe("The start (ISO) of the period the note is ABOUT (a milestone's week) — carried as startedAtTime, so time-placed views place the note there. The record's own generatedAtTime stays the write time."),
		until: z.string().optional().describe("The end (ISO) of the period the note is about — carried as endedAtTime; with `at`, time-placed views read the note as an interval."),
		links: z.array(AnnotationQuoteSchema).optional().describe("Further passages in the same document this note cross-references; each renders as a followable link."),
	})
	.describe(
		"The full shape of one W3C Web Annotation: the anchored passage, the note, its meaningful time, and any cross-referenced passages. The prose annotate forms each bind a slice of this; this composite carries all of it at once.",
	);
export type TAnnotationNote = z.infer<typeof AnnotationNoteSchema>;
export const annotationNoteDomainDefinition: TDomainDefinition = {
	selectors: [ANNOTATION_NOTE_DOMAIN],
	schema: AnnotationNoteSchema,
	coerce: (proto: { value?: unknown }) => AnnotationNoteSchema.parse(typeof proto.value === "string" ? JSON.parse(proto.value) : proto.value),
	description: "A complete annotation act as one value: passage, note, time, and cross-reference links.",
};

// ============================================================================
// Discourse write helpers — comment and annotation acts over a quad store
// ============================================================================

/** The store surface the discourse write helpers use: node upsert, quad add/query, and (property-graph stores only) a
 *  navigable createEdge. Every consumer store implements it; keeping it minimal keeps these helpers store-agnostic. */
export type TDiscourseStore = {
	upsertIndividual(label: string, data: unknown): Promise<string>;
	query(pattern: { subject?: string; predicate?: string; object?: unknown }): Promise<Array<{ subject: string; predicate: string; object: unknown }>>;
	add(quad: { subject: string; predicate: string; object: unknown; namedGraph: string; objectType?: string }): Promise<void>;
	createEdge?(fromLabel: string, fromId: string, edgeLabel: string, toLabel: string, toId: string): Promise<void>;
};

/** A Comment's display name — its note text on one line, truncated so a graph view titles by what it says, not its id. */
const COMMENT_NAME_MAX = 60;
export function commentName(text: string): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > COMMENT_NAME_MAX ? `${oneLine.slice(0, COMMENT_NAME_MAX - 1)}…` : oneLine;
}

/** Write a navigable edge: a property-graph store materializes a real, walkable edge; a quad store models it as a quad. */
export async function writeEdge(store: TDiscourseStore, fromLabel: string, fromId: string, rel: string, toLabel: string, toId: string): Promise<void> {
	if (store.createEdge) await store.createEdge(fromLabel, fromId, rel, toLabel, toId);
	// objectType records the target's type, so the quad reads back as an edge rather than a literal property.
	else await store.add({ subject: fromId, predicate: rel, object: toId, namedGraph: fromLabel, objectType: toLabel });
}

/** Create a Comment individual with its markdown body as a Body sub-resource — the shared act behind `comment` and
 *  `annotate`. `name` titles the node by the note text (truncated) rather than its id. */
export async function createComment(store: TDiscourseStore, author: string, text: string, now: string, period?: { start?: string; end?: string }): Promise<string> {
	const commentId = crypto.randomUUID();
	await store.upsertIndividual(COMMENT_LABEL, {
		id: commentId,
		author,
		generatedAtTime: now,
		...(period?.start ? { startedAtTime: period.start } : {}),
		...(period?.end ? { endedAtTime: period.end } : {}),
		name: commentName(text),
	});
	const bodyId = `body-${commentId}-text-markdown`;
	await store.upsertIndividual(BODY_LABEL, { id: bodyId, content: text, mediaType: "text/markdown", generatedAtTime: now });
	await writeEdge(store, COMMENT_LABEL, commentId, LinkRelations.HAS_BODY.rel, BODY_LABEL, bodyId);
	return commentId;
}

/** Anchor a passage inside (sourceLabel, sourceId): a TextQuoteSelector for the quote (its optional prefix/suffix context
 *  making a short or repeated quote resolve reliably) plus a SpecificResource naming the source and the selector. Returns
 *  the SpecificResource id — the target a Comment's oa:hasTarget (anchor) or oa:hasBody linksTo (cross-reference) points at. */
export async function anchorPassage(store: TDiscourseStore, sourceLabel: string, sourceId: string, quote: { exact: string; prefix?: string; suffix?: string }, now: string): Promise<string> {
	const selectorId = crypto.randomUUID();
	await store.upsertIndividual(TEXT_QUOTE_SELECTOR_LABEL, {
		id: selectorId,
		exact: quote.exact,
		...(quote.prefix !== undefined ? { prefix: quote.prefix } : {}),
		...(quote.suffix !== undefined ? { suffix: quote.suffix } : {}),
		generatedAtTime: now,
	});
	const specificResourceId = crypto.randomUUID();
	await store.upsertIndividual(SPECIFIC_RESOURCE_LABEL, { id: specificResourceId, generatedAtTime: now });
	await writeEdge(store, SPECIFIC_RESOURCE_LABEL, specificResourceId, LinkRelations.HAS_SOURCE.rel, sourceLabel, sourceId);
	await writeEdge(store, SPECIFIC_RESOURCE_LABEL, specificResourceId, LinkRelations.HAS_SELECTOR.rel, TEXT_QUOTE_SELECTOR_LABEL, selectorId);
	return specificResourceId;
}

/** Rels that ground a Comment in what it concerns: an oa:hasTarget subject or an attachment. Reply-family rels
 *  (inReplyTo and its sub-properties, e.g. narrate) also ground it — checked via isReplyEdge. */
const GROUNDING_RELS = new Set<string>([LinkRelations.TARGET.rel, LinkRelations.ATTACHMENT.rel]);

/** Enforce that a Comment references what it is about: an oa:hasTarget subject, an attachment, or (in a thread) the
 *  comment it replies to. No floating comments. A conversation root with no subject is a deliberate general question and
 *  its own origin — callers skip the check there. */
export async function assertCommentGrounded(store: TDiscourseStore, commentId: string): Promise<void> {
	const quads = await store.query({ subject: commentId });
	const grounded = quads.some((q) => GROUNDING_RELS.has(q.predicate) || isReplyEdge(q.predicate));
	if (!grounded) throw new Error(`Comment "${commentId}" is not grounded — every comment must reference what it is about (hasTarget, attachment, or a reply edge).`);
}

/** Walk reply-family edges upward from an individual to its conversation root, so a comment groups under the same root
 *  as what it concerns. Stops at the first individual with no reply parent (a top-level subject is its own root). */
export async function conversationRoot(store: TDiscourseStore, id: string): Promise<string> {
	let root = id;
	for (let depth = 0; depth < 100; depth++) {
		const quads = await store.query({ subject: root });
		const parent = quads.find((q) => isReplyEdge(q.predicate));
		if (!parent) break;
		const parentId = String(parent.object);
		if (!parentId || parentId === root) break;
		root = parentId;
	}
	return root;
}

/** Write a W3C Web Annotation anchored in (label, id): the anchor passage (oa:hasTarget), the note, and — for a linking
 *  annotation — a second anchored passage the note cross-references (oa:hasBody linksTo). The quote carries optional
 *  prefix/suffix context so what is annotated is determined reliably. Shared by every annotate variant. */
export async function writeAnnotation(
	store: TDiscourseStore,
	author: string,
	a: { label: string; id: string; exact: string; prefix?: string; suffix?: string; text: string; at?: string; until?: string; links?: Array<{ exact: string; prefix?: string; suffix?: string }> },
): Promise<{ commentId: string; specificResourceId: string; linkedSpecificResourceIds?: string[] }> {
	// `at`/`until` bound the period the note is ABOUT (a milestone's week) — subject time, carried as
	// startedAtTime/endedAtTime so time-placed views (gantt) show the note over its period. `generatedAtTime`
	// stays the moment the record was written; the two are different facts and never conflated.
	const now = new Date().toISOString();
	const specificResourceId = await anchorPassage(store, a.label, a.id, a, now);
	const commentId = await createComment(store, author, a.text, now, { start: a.at, end: a.until });
	await writeEdge(store, COMMENT_LABEL, commentId, LinkRelations.TARGET.rel, SPECIFIC_RESOURCE_LABEL, specificResourceId);
	const linkedSpecificResourceIds: string[] = [];
	for (const link of a.links ?? []) {
		const linkedId = await anchorPassage(store, a.label, a.id, link, now);
		await writeEdge(store, COMMENT_LABEL, commentId, LinkRelations.LINKS_TO.rel, SPECIFIC_RESOURCE_LABEL, linkedId);
		linkedSpecificResourceIds.push(linkedId);
	}
	await assertCommentGrounded(store, commentId);
	return { commentId, specificResourceId, ...(linkedSpecificResourceIds.length > 0 ? { linkedSpecificResourceIds } : {}) };
}

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
	/** One or more parent rels (rdfs:subPropertyOf). A rel may sit under several upper concepts at once. */
	subPropertyOf?: string | string[];
	presentation?: TRelPresentation;
	/** Actor-edge ordering weight (highest wins) — see TEdgeDef.rolePriority. */
	rolePriority?: number;
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
		const extras = entry as { label?: string; icon?: string; subPropertyOf?: string | string[]; presentation?: TRelPresentation; rolePriority?: number };
		if (extras.label !== undefined) record.label = extras.label;
		if (extras.icon !== undefined) record.icon = extras.icon;
		if (extras.subPropertyOf !== undefined) record.subPropertyOf = extras.subPropertyOf;
		if (extras.presentation !== undefined) record.presentation = extras.presentation;
		if (extras.rolePriority !== undefined) record.rolePriority = extras.rolePriority;
		return record;
	});
}
