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

/** Root node label — any resource. Use as edge range when the target is polymorphic. */
export const RESOURCE_LABEL = "Resource";

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
	PUBLISHED: { rel: "published", uri: "as:published", range: "literal" },
	ATTRIBUTED_TO: { rel: "attributedTo", uri: "as:attributedTo", range: "iri" },
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
	// PROV-O — provenance and lineage
	// Entity → the responsible Agent (the party a node is attributed to: issuer/holder/verifier/author/…, or its producing
	// instance). The canonical role/provenance edge for the fisheye's HypermediaRole grouping axis (see grouping.ts ROLE_RELS).
	WAS_ATTRIBUTED_TO: { rel: "wasAttributedTo", uri: "prov:wasAttributedTo", range: "iri" },
	WAS_GENERATED_BY: { rel: "wasGeneratedBy", uri: "prov:wasGeneratedBy", range: "iri" },
	WAS_INFORMED_BY: { rel: "wasInformedBy", uri: "prov:wasInformedBy", range: "iri", subPropertyOf: "inReplyTo" },
	INVALIDATED: { rel: "invalidated", uri: "prov:invalidated", range: "iri", subPropertyOf: "inReplyTo" },
	WAS_ASSOCIATED_WITH: { rel: "wasAssociatedWith", uri: "prov:wasAssociatedWith", range: "iri" },
	WAS_STARTED_BY: { rel: "wasStartedBy", uri: "prov:wasStartedBy", range: "iri", subPropertyOf: "inReplyTo" },
	STARTED_AT_TIME: { rel: "startedAtTime", uri: "prov:startedAtTime", range: "literal", subPropertyOf: ["ganttStart", "temporalInstant"] },
	ENDED_AT_TIME: { rel: "endedAtTime", uri: "prov:endedAtTime", range: "literal", subPropertyOf: ["ganttEnd", "temporalInstant"] },
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
	// upper concepts (and the time rels also under temporalInstant), so a paint recognises schedulable data via
	// isSubPropertyOf regardless of which concrete vocabulary (PROV, schema, hbn) supplied each field.
	TEMPORAL_INSTANT: { rel: "temporalInstant", uri: "time:Instant", range: "literal" },
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
	// W3C Verifiable Credentials (cred: = https://www.w3.org/2018/credentials#). Each rel string is the genuine compact
	// term AND the graph edge label the steppers write (the role fold groups on the edge label); the uri is its JSON-LD
	// @id. holder is a VerifiablePresentation property — never a credential property (VC DM 2.0 §4.13) — so a credential
	// is attributed to its issuer (cred:issuer) and is ABOUT its subject (cred:credentialSubject); possession lives on the
	// presentation the holder controls.
	VALID_FROM: { rel: "validFrom", uri: "cred:validFrom", range: "literal" },
	VALID_UNTIL: { rel: "validUntil", uri: "cred:validUntil", range: "literal" },
	// An artifact's publication in a verifiable data registry — the issuer publishes its key/status-list there and a
	// verifier resolves them from it. A haibun-native rel (no genuine W3C term names this); it is the top-priority
	// role/grouping edge so a published artifact groups under the registry, not its controlling issuer.
	REGISTERED_IN: { rel: "registeredIn", uri: "hbn:registeredIn", range: "iri" },
	CREDENTIAL_ISSUER: { rel: "issuer", uri: "cred:issuer", range: "iri" },
	CREDENTIAL_SUBJECT: { rel: "credentialSubject", uri: "cred:credentialSubject", range: "iri" },
	CREDENTIAL_HOLDER: { rel: "holder", uri: "cred:holder", range: "iri" },
	VERIFIABLE_CREDENTIAL: { rel: "verifiableCredential", uri: "cred:verifiableCredential", range: "iri" },
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

export type TPropertyDef = TRel | TContentPropertyDef;

export function isContentPropertyDef(def: TPropertyDef | undefined): def is TContentPropertyDef {
	return typeof def === "object" && def !== null && def.rel === "content";
}

/** Edge definition: target node type. The rel is resolved from EdgePredicates[key]; override with explicit rel for domain-specific edges not in the canonical set. */
export type TEdgeDef = { range: string; rel?: TRel };

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
	seqPath: z.string().optional(),
	body: z.string().optional(),
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
		id: "id",
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			author: LinkRelations.ATTRIBUTED_TO.rel,
			generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
			seqPath: LinkRelations.SEQ_PATH.rel,
			body: { rel: LinkRelations.CONTENT.rel, mediaType: "text/markdown" },
		},
		edges: {
			[HAS_BODY_EDGE]: { rel: LinkRelations.HAS_BODY.rel, range: BODY_LABEL },
			// What the comment is about — any Resource (an entity, or another Comment in a thread).
			[LinkRelations.TARGET.rel]: { rel: LinkRelations.TARGET.rel, range: RESOURCE_LABEL },
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
	/** rdfs:label — an optional human name for this Principal (a DID has none intrinsically). Lets an instance/party be titled by a readable name instead of its DID; resolved as the top display-label headline (the universal `label`→rdfs:label rel). */
	label: z.string().optional(),
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
	description: "A person or service that acts in this system — the author behind records, comments, and decisions — identified by a DID (a public, verifiable address).",
	topology: {
		persistedAs: PRINCIPAL_LABEL,
		type: "sec:Controller",
		// A Principal IS the responsible agent every persisted node is attributed to (prov:wasAttributedTo, range prov:Agent);
		// declare sec:Controller a kind of prov:Agent so that attribution is well-formed against the rel's range.
		subClassOf: "prov:Agent",
		id: "id",
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
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
		sortColumns: { controller: "TEXT", generatedAtTime: "TIMESTAMPTZ", revoked: "BOOLEAN" },
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

/**
 * Pick a body's content by media type from an individual's `hasBody` projection.
 * Returns undefined if no body matches. Used by readers that consume content
 * after `getIndividual` has inlined the linked Body sub-resources.
 */
export function bodyByMediaType(individual: { hasBody?: Array<{ mediaType?: string; content?: string }> } | null | undefined, mediaType: string): string | undefined {
	return individual?.hasBody?.find((b) => b.mediaType === mediaType)?.content;
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
		const extras = entry as { label?: string; icon?: string; subPropertyOf?: string | string[]; presentation?: TRelPresentation };
		if (extras.label !== undefined) record.label = extras.label;
		if (extras.icon !== undefined) record.icon = extras.icon;
		if (extras.subPropertyOf !== undefined) record.subPropertyOf = extras.subPropertyOf;
		if (extras.presentation !== undefined) record.presentation = extras.presentation;
		return record;
	});
}
