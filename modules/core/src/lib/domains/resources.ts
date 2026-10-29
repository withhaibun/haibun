/**
 * This module declares the vocabulary and topology of the records a graph stores.
 *
 * It defines what a graph resource is, how it is typed, how it links and how access to it is governed. It holds zod
 * schemas, type aliases, vocabulary consts, small pure derivations and write helpers over a quad store. It doesn't
 * import node built-ins, so it runs in a browser.
 *
 * Contents:
 *   - Resource identity (id/type), Access levels, Comment vocabulary
 *   - LinkRelations + EdgePredicates: semantic labels for properties and edges (ActivityStreams / JSON-LD)
 *   - TRel / TPropertyDef / TEdgeDef / TDomainTopology: the shape of a node-type declaration
 *   - TDomainDefinition / TRegisteredDomain: how steppers register a domain
 *   - Helpers: getRelRange, getRelPresentation, edgeRel, isSubPropertyOf, isReplyEdge
 *   - Write helpers over a quad store: comments, annotations, and the facts a text's links state
 *
 * The model follows JSON-LD, ActivityStreams and RDF. A node label is a local handle. `type` is the RDF class URI that
 * JSON-LD emits. `id` is the IRI.
 */
import { stripTrailingSlash } from "./local-origin.js";
import { PROV_ACTIVITY, PROV_AGENT } from "./vocabularies.js";
import { z } from "zod";
import { MEDIA_TYPE } from "./media-types.js";
import { FragmentSchema, isFragment } from "./media-fragments.js";
import { fromJsonText } from "./json-text.js";
import type { TListDeclaration } from "./lists.js";
import type { TRecordType } from "../steps/domains/quad-types.js";

// ============================================================================
// Resource identity
// ============================================================================

/**
 * The shape of every identifiable, typed record.
 * `id` is the identifier, emitted as the IRI in JSON-LD. `type` is the RDF class, typically a compact IRI such as
 * "as:Document", which the JSON-LD context maps to `@type`.
 *
 * Field names follow W3C JSON-LD-based data models, with unquoted `id` and `type` as in ActivityStreams 2.0. The context
 * produces the `@id` and `@type` JSON-LD keywords at serialization time.
 */
export const ResourceSchema = z.object({ id: z.string(), type: z.string() });
/** The root node label. It stands for any resource. Use it as an edge range when the target is polymorphic. */
export const RESOURCE_LABEL = "Resource";

/** haibun's canonical vocabulary namespace. It is the base where a request doesn't supply a serving host, and a consumer
 *  publishes a sub-vocabulary under it. A served @context binds `hbn` under the request host instead. */
export const HAIBUN_NS = "https://withhaibun.github.io/ns/";
const HAIBUN_NS_PATH = "/ns/";
/** The @context prefix bound to the haibun namespace. Any other prefix names a separate vocabulary, not haibun's. */
export const HAIBUN_PREFIX = "hbn";
export const HAIBUN_PREFIXES = [HAIBUN_PREFIX] as const;

/** The namespace of the records' IRIs: the @context prefix a record's `@id` states, and the namespace the prefix stands for in
 *  the served context. An application serves its records under its own prefix and namespace, which its context states, and haibun serves
 *  its records under haibun's namespace. */
export const RecordNamespaceSchema = z.object({ prefix: z.string().min(1), namespace: z.string().min(1) });
export type TRecordNamespace = z.infer<typeof RecordNamespaceSchema>;
/** The namespace of haibun's records, which an application's runtime replaces with the application's namespace. */
export const HAIBUN_RECORD_NAMESPACE: TRecordNamespace = { prefix: HAIBUN_PREFIX, namespace: HAIBUN_NS };

/** Returns the haibun namespace under a request origin (`https://192.0.2.9:8223` → `…/ns/`), or the canonical stem
 *  without an origin. Pass the result to getJsonLdContext's `haibunNs`. */
export function haibunNsForHost(baseOrigin?: string): string {
	return baseOrigin ? `${stripTrailingSlash(baseOrigin)}${HAIBUN_NS_PATH}` : HAIBUN_NS;
}

// ============================================================================
// Access levels
// ============================================================================

/**
 * The visibility policy for stored resources:
 *   - private: visible only to the resource's owner.
 *   - public: visible to everyone.
 *   - opened: a private resource widened for audit. History keeps the prior state.
 *
 * Query contexts also accept `all`, which means "do not filter by access level". `all` isn't a storage value and
 * applies only at query time.
 */
const ACCESS_LEVELS = ["private", "public", "opened"] as const;
const ACCESS_QUERY_LEVELS = [...ACCESS_LEVELS, "all"] as const;

export const AccessLevelSchema = z.enum(ACCESS_LEVELS, { message: `accessLevel must be one of ${ACCESS_LEVELS.map((v) => `"${v}"`).join(", ")}` });
export type AccessLevel = z.infer<typeof AccessLevelSchema>;
export const Access = AccessLevelSchema.enum;

export const AccessQueryLevelSchema = z.enum(ACCESS_QUERY_LEVELS, { message: `accessLevel (query) must be one of ${ACCESS_QUERY_LEVELS.map((v) => `"${v}"`).join(", ")}` });
export type AccessQueryLevel = z.infer<typeof AccessQueryLevelSchema>;
export const AccessQuery = AccessQueryLevelSchema.enum;

/**
 * The base schema that every type persisted as a vertex in a quad store extends. Every persisted type states
 * `accessLevel` in its schema and its topology, so every row has a level at read time. A record that doesn't state a
 * level takes its type's level at write time. That level isn't wider than the level the writer sees. A type that
 * doesn't declare the property can't classify its records. A store's registration guard enforces the declaration, and
 * this base schema supplies it.
 */
export const PersistedVertexSchema = z.object({
	accessLevel: AccessLevelSchema.optional().describe("How widely the record is shared. A record that doesn't state a level is classified by its type at write time."),
});
/** The time a record was generated, which a record written without one takes as the time it is written: as a date, and as
 *  the ISO text a type declared by its context holds. */
export const GeneratedAtTimeSchema = z.coerce.date().default(() => new Date());
export const GeneratedAtTimeTextSchema = z.string().default(() => new Date().toISOString());
/** Ranks how much of the graph each level lets a reader see, so two levels can be compared. A reader at a level sees
 *  the records at that level and at each narrower level. A private reader sees every record, and a public reader sees
 *  the public records. */
const ACCESS_BREADTH: Record<AccessLevel, number> = { public: 0, opened: 1, private: 2 };

/** Every level, broadest first. */
export const ACCESS_BROADEST_FIRST = (Object.keys(ACCESS_BREADTH) as AccessLevel[]).sort((a, b) => ACCESS_BREADTH[b] - ACCESS_BREADTH[a]);

/** Returns the narrower of the level in force and a requested level. It applies when code inside a scope requests a level of its own. */
export function narrowerAccess(inForce: AccessLevel, asked: AccessLevel): AccessLevel {
	return ACCESS_BREADTH[asked] < ACCESS_BREADTH[inForce] ? asked : inForce;
}

/** Returns the level a record states. A record that doesn't state a level, or states one outside the declared levels,
 *  throws, because a read can't determine how widely the record was meant to be shared. Every write states the level. */
export function statedLevel(level: unknown): AccessLevel {
	if (level === undefined || level === null)
		throw new Error(`a read refuses a record that doesn't state its access level. Write the record through a store that states its type's declared level.`);
	const stated = AccessLevelSchema.safeParse(level);
	if (!stated.success) throw new Error(`a record states the access level ${JSON.stringify(level)}, which isn't one of ${ACCESS_BROADEST_FIRST.join(", ")}`);
	return stated.data;
}

/** Returns whether a read at `asked` may see a record at `level`. Every store applies this rule. A record without a stated
 *  level throws (`statedLevel`). */
export function withinAccess(level: unknown, asked: AccessLevel): boolean {
	return ACCESS_BREADTH[statedLevel(level)] <= ACCESS_BREADTH[asked];
}

/** Returns the levels whose records a read at `seen` returns. A store that applies the rule as a query, and not as a per-record test, calls it. */
export function levelsWithin(seen: AccessLevel): AccessLevel[] {
	return ACCESS_BROADEST_FIRST.filter((level) => withinAccess(level, seen));
}

/** Returns the scope a store read runs at for a requested level. `all` requests every level, and a store reads it at its
 *  widest level. Surfaces share this function, so two surfaces don't scope the same request differently. */
export function storeScopeFor(asked: AccessQueryLevel): AccessLevel {
	return asked === AccessQuery.all ? Access.private : asked;
}

/** Returns the narrower of two ceilings. Either may be absent, and an absent ceiling doesn't bound the read. */
export function narrowerCeiling(inForce: AccessLevel | undefined, asked: AccessLevel | undefined): AccessLevel | undefined {
	if (!inForce) return asked;
	if (!asked) return inForce;
	return narrowerAccess(inForce, asked);
}

// ============================================================================
// Comment vocabulary
// ============================================================================

/**
 * A free-text annotation attached to any Resource. Comments thread through IN_REPLY_TO.
 * The discourse edge predicate expresses the speech act as a sub-property of inReplyTo and not as the bare
 * superproperty. `CommentSchema` and `commentDomainDefinition` near the end of this file declare the full Zod schema
 * and domain definition.
 */
export const COMMENT_LABEL = "Comment";
/** Whether records of `label` are comments: notes about another record, which a thread shows as replies. */
export const isCommentType = (label: string): boolean => label === COMMENT_LABEL;
export const COMMENT_DOMAIN = "comment";

/** Web Annotation node labels for the target side of an annotation (a Comment anchored inside a source). They are
 *  declared here so the Comment topology can carry a `linksTo` edge to a SpecificResource. Their schemas and domain
 *  definitions follow below. */
export const SPECIFIC_RESOURCE_LABEL = "SpecificResource";
export const TEXT_QUOTE_SELECTOR_LABEL = "TextQuoteSelector";
export const FRAGMENT_SELECTOR_LABEL = "FragmentSelector";

/** A Body holds opaque content of any kind, such as text or JSON, typed by `mediaType`. */
export const BODY_LABEL = "Body";

const BODY_DOMAIN = "body";
/** The edge from any resource to a Body sub-resource. */
export const HAS_BODY_EDGE = "hasBody";

/**
 * A Reading records one reading of a text that asserts what the text's links state (`prov:Activity`). Each source has
 * one Reading. It names the source it read (`prov:used`), the step that read it and the statements it made. Reading a
 * rewritten text then retracts the statements the previous reading asserted and doesn't retract a statement a person
 * asserted by hand.
 */
export const READING_LABEL = "Reading";
const READING_DOMAIN = "reading";

/**
 * A SeqPath is the hierarchical step identifier reified as a graph node.
 *
 * `featureStep.seqPath: number[]` is the hierarchical id within an actuality feature, such as [0,1,2,10] → "0.1.2.10". Step dispatch
 * emits SeqPath quads on step entry and exit, so any structured emission within a step's context can link back to it
 * through LinkRelations.SEQ_PATH.
 */
export const SEQ_PATH_LABEL = "SeqPath";

/** The facts graph. Each record is one product of a step, and links the step that produced it. */
export const FACT_LABEL = "facts";

/** The ontology's two types. A Class record describes a declared type, and a Property record describes a link relation. */
export const CLASS_LABEL = "Class";
export const PROPERTY_LABEL = "Property";

/**
 * The discourse rels. Each speech act is a sub-property of `inReplyTo`.
 * The discourse value is the edge predicate, as in (comment, narrate, parent).
 * Writing a discourse edge also writes inReplyTo, which materializes the entailment.
 */
export const DISCOURSE_RELS = ["measure", "narrate", "question", "play", "petition", "grant", "deny", "invoke", "revoke"] as const;
export type TDiscourseRel = (typeof DISCOURSE_RELS)[number];

// ============================================================================
// Link relations & edge predicates (ActivityStreams / JSON-LD vocabulary)
// ============================================================================

/**
 * Link relation types are the set of semantic rels for node properties and edges.
 * Declaration order sets column display priority in result tables.
 *
 * `range` is the predicate's RDF range, the kind of value it points at:
 *   - "iri":       another resource (an IRI or node id). Renders as a navigable item.
 *   - "literal":   a literal value (string, number, date). Renders as a filter.
 *   - "container": a multi-valued structure (bag, list or nested context).
 *                  Renders as a select or select-like control.
 *
 * This is a small subset of RDFS without a reasoner. It keeps `linkRelFromSemantic` a one-line lookup and not a
 * growing chain.
 *
 * Reply and conversation semantics use per-entry `subPropertyOf: "inReplyTo"`, and ancestry checks walk the chain through `isSubPropertyOf`.
 */
export type TRelRange = "iri" | "literal" | "container";

/**
 * The section of a resource's presentation that renders a property carrying this rel. The rel declares its bucket and
 * renderers read it. A bucket describes intent and not audience: every accessor (person, agent, LLM) receives all data,
 * and the bucket names only the layout position.
 *   "summary": the resource's primary identification line, at the top of the card.
 *   "body": the main content area, rendered as an iframe, prose or a structured body.
 *   "governance": control rules about the resource, such as accessLevel and capability bindings. They render in a
 *                  labelled governance section and aren't mixed into content fields.
 * A rel without a presentation renders in the regular field table.
 */
type TRelPresentation = "summary" | "body" | "governance";

/**
 * Optional per-rel metadata, aligned with RDFS:
 *   subPropertyOf: names one parent rel or several (rdfs:subPropertyOf). The rel inherits each parent's semantics
 *                   for ancestry walks.
 *   label: the human-readable display name (rdfs:label). Renderers show it in place of the raw rel string when it
 *                   is set.
 *   icon: a visual badge for the rel. Renderers show it next to the label in references, threads and discourse views.
 */

export const LinkRelations = {
	NAME: { rel: "name", uri: "as:name", range: "literal", presentation: "summary" as TRelPresentation },
	// schema.org: the ordered steps of a HowTo. A saved waypoint's activity holds the lines it runs in this rel.
	STEP: { rel: "step", uri: "schema:step", range: "container" },
	PUBLISHED: { rel: "published", uri: "as:published", range: "literal", subPropertyOf: "ganttStart" },
	ATTRIBUTED_TO: { rel: "attributedTo", uri: "as:attributedTo", range: "iri", subPropertyOf: "fromActor", rolePriority: 10 },
	// The addressee of an act: a message's recipients, a question's addressee, or the requester to whom a decision responds.
	// It is a toActor member, so an addressed act reads as a message from its attributed agent to its audience.
	AUDIENCE: { rel: "audience", uri: "as:to", range: "iri", subPropertyOf: "toActor", rolePriority: 45 },
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
	// schema.org: a work references an entity it names but doesn't describe (schema:mentions). A body-bearing individual,
	// such as an email or a document, has this edge to each person, place, organization or other entity extracted from it.
	// An untyped link also states this rel. A link whose text doesn't name a property type still indicates that the text refers to its target.
	MENTIONS: { rel: "mentions", uri: "schema:mentions", range: "iri" },
	// CiTO (Citation Typing Ontology): one work cites another. The refinement states that the citing work offers the cited
	// passage as evidence for its statements. A feature that cites the requirement it exercises states the refinement, so
	// "which requirements are evidenced" is a query over stored facts and not a naming convention.
	CITES: { rel: "cites", uri: "cito:cites", range: "iri" },
	CITES_AS_EVIDENCE: { rel: "citesAsEvidence", uri: "cito:citesAsEvidence", range: "iri", subPropertyOf: "cites" },
	// W3C Web Annotation (oa:) anchors an annotation inside its source. An annotating Comment's hasTarget points at an
	// oa:SpecificResource. The SpecificResource names the whole document (hasSource) and the anchored segment
	// (hasSelector). The segment is a TextQuoteSelector whose exact, prefix and suffix quote the text, so the anchor
	// remains valid after re-import and re-rendering.
	HAS_SOURCE: { rel: "hasSource", uri: "oa:hasSource", range: "iri" },
	HAS_SELECTOR: { rel: "hasSelector", uri: "oa:hasSelector", range: "iri" },
	EXACT: { rel: "exact", uri: "oa:exact", range: "literal", presentation: "summary" as TRelPresentation },
	PREFIX: { rel: "prefix", uri: "oa:prefix", range: "literal" },
	SUFFIX: { rel: "suffix", uri: "oa:suffix", range: "literal" },
	// A FragmentSelector locates a part of a document or media by a fragment of its address (rdf:value), in the form the
	// specification it names (dcterms:conformsTo) defines: a PDF's page, a span of audio or video, a region of an image.
	VALUE: { rel: "value", uri: "rdf:value", range: "literal", presentation: "summary" as TRelPresentation },
	CONFORMS_TO: { rel: "conformsTo", uri: "dcterms:conformsTo", range: "iri" },
	// A linking annotation (oa:motivation oa:linking) is a cross-reference. The note anchored at one passage points at
	// another passage in the same source. It is an edge from the annotating Comment to the linked SpecificResource, so a
	// reader who follows the note reaches the section it references.
	LINKS_TO: { rel: "linksTo", uri: "oa:hasBody", range: "iri" },
	// PROV-O: provenance and lineage
	// Entity → the responsible Agent: the party a node is attributed to, or the instance that produced it. It is the
	// provenance attribution edge. It is a role attribution through fromActor, and fromActor is a sub-property of the
	// broad role super-property inRoleOf below. The polymorphic view's HypermediaRole grouping axis therefore derives it
	// (see roleRels).
	WAS_ATTRIBUTED_TO: { rel: "wasAttributedTo", uri: "prov:wasAttributedTo", range: "iri", subPropertyOf: "fromActor", rolePriority: 20 },
	WAS_GENERATED_BY: { rel: "wasGeneratedBy", uri: "prov:wasGeneratedBy", range: "iri" },
	// What an activity read to do its work. A Reading names the text whose links it turned into statements.
	USED: { rel: "used", uri: "prov:used", range: "iri" },
	// The statements a reading asserted. A later reading of the same source retracts these statements.
	STATED: { rel: "stated", uri: "hbn:stated", range: "container" },
	WAS_INFORMED_BY: { rel: "wasInformedBy", uri: "prov:wasInformedBy", range: "iri", subPropertyOf: "inReplyTo" },
	INVALIDATED: { rel: "invalidated", uri: "prov:invalidated", range: "iri", subPropertyOf: "inReplyTo" },
	WAS_STARTED_BY: { rel: "wasStartedBy", uri: "prov:wasStartedBy", range: "iri", subPropertyOf: "inReplyTo" },
	// The activity that ended another: the step of a start-up that ended a record an interrupted actuality left without an end.
	WAS_ENDED_BY: { rel: "wasEndedBy", uri: "prov:wasEndedBy", range: "iri", subPropertyOf: "inReplyTo" },
	STARTED_AT_TIME: { rel: "startedAtTime", uri: "prov:startedAtTime", range: "literal", subPropertyOf: "ganttStart" },
	ENDED_AT_TIME: { rel: "endedAtTime", uri: "prov:endedAtTime", range: "literal", subPropertyOf: "ganttEnd" },
	// The time the system generated this entity's representation. Every persisted object requires it. as:published holds the content's own time.
	GENERATED_AT_TIME: { rel: "generatedAtTime", uri: "prov:generatedAtTime", range: "literal" },
	/** The time a record was written, or last rewritten. A reader following actuality orders its records by this time. */
	RECORDED_AT_TIME: { rel: "recordedAtTime", uri: "hbn:recordedAtTime", range: "literal" },
	// SOSA / W3C SSN, observation and sensing
	PHENOMENON_TIME: { rel: "phenomenonTime", uri: "sosa:phenomenonTime", range: "literal" },
	RESULT_TIME: { rel: "resultTime", uri: "sosa:resultTime", range: "literal" },
	HAS_RESULT: { rel: "hasResult", uri: "sosa:hasResult", range: "container" },
	MADE_BY_SENSOR: { rel: "madeBySensor", uri: "sosa:madeBySensor", range: "iri", subPropertyOf: "inReplyTo" },
	OBSERVED_PROPERTY: { rel: "observedProperty", uri: "sosa:observedProperty", range: "literal" },
	// schema.org: action outcomes
	SCHEMA_OBJECT: { rel: "schemaObject", uri: "schema:object", range: "literal" },
	SCHEMA_RESULT: { rel: "schemaResult", uri: "schema:result", range: "literal" },
	// schema.org: the reason an action failed, stated on that action.
	ERROR: { rel: "error", uri: "schema:error", range: "literal" },
	REPLACEE: { rel: "replacee", uri: "schema:replacee", range: "literal" },
	REPLACEMENT: { rel: "replacement", uri: "schema:replacement", range: "literal" },
	ACTION_STATUS: { rel: "actionStatus", uri: "schema:actionStatus", range: "literal" },
	PART_OF: { rel: "isPartOf", uri: "schema:isPartOf", range: "iri" },
	PRECEDED_BY: { rel: "precededBy", uri: "hbn:precededBy", range: "iri" },
	// Scheduling and Gantt rels for task timing, effort and dependencies. Concrete rels declare a gantt-* upper concept as
	// their parent, so a paint recognises schedulable data through isSubPropertyOf. The concrete vocabulary (PROV, schema,
	// hbn) that supplied each field doesn't matter.
	GANTT_START: { rel: "ganttStart", uri: "hbn:ganttStart", range: "literal" },
	GANTT_END: { rel: "ganttEnd", uri: "hbn:ganttEnd", range: "literal" },
	GANTT_DURATION: { rel: "ganttDuration", uri: "hbn:ganttDuration", range: "literal" },
	GANTT_EFFORT: { rel: "ganttEffort", uri: "hbn:ganttEffort", range: "literal" },
	GANTT_DEPENDS: { rel: "ganttDepends", uri: "hbn:ganttDependsOn", range: "iri" },
	DURATION: { rel: "duration", uri: "schema:duration", range: "literal", subPropertyOf: "ganttDuration" },
	EFFORT: { rel: "effort", uri: "hbn:effort", range: "literal", subPropertyOf: "ganttEffort" },
	DEPENDS_ON: { rel: "dependsOn", uri: "hbn:dependsOn", range: "iri", subPropertyOf: "ganttDepends" },
	// haibun-native discourse speech acts. Each is a sub-property of inReplyTo.
	MEASURE: { rel: "measure", uri: "hbn:measure", range: "iri", subPropertyOf: "inReplyTo", label: "Measure", icon: "📊" },
	NARRATE: { rel: "narrate", uri: "hbn:narrate", range: "iri", subPropertyOf: "inReplyTo", label: "Narrate", icon: "💬" },
	QUESTION: { rel: "question", uri: "hbn:question", range: "iri", subPropertyOf: "inReplyTo", label: "Question", icon: "❓" },
	PLAY: { rel: "play", uri: "hbn:play", range: "iri", subPropertyOf: "inReplyTo", label: "Play", icon: "▶️" },
	PETITION: { rel: "petition", uri: "hbn:petition", range: "iri", subPropertyOf: "inReplyTo", label: "Petition", icon: "🙋" },
	GRANT: { rel: "grant", uri: "hbn:grant", range: "iri", subPropertyOf: "inReplyTo", label: "Grant", icon: "🪪" },
	DENY: { rel: "deny", uri: "hbn:deny", range: "iri", subPropertyOf: "inReplyTo", label: "Deny", icon: "⛔" },
	INVOKE: { rel: "invoke", uri: "hbn:invoke", range: "iri", subPropertyOf: "inReplyTo", label: "Invoke", icon: "⚡" },
	REVOKE: { rel: "revoke", uri: "hbn:revoke", range: "iri", subPropertyOf: "inReplyTo", label: "Revoke", icon: "↩️" },
	// Other haibun-native rels
	SEQ_PATH: { rel: "seqPath", uri: "hbn:seqPath", range: "iri" },
	// The feature document a step was written in, as a path a reader can open. It is a literal location and not the
	// step's identity. The step's identity is its seqPath id. A second `identifier` on one record would state that the
	// record has two names.
	SOURCE_PATH: { rel: "sourcePath", uri: "hbn:sourcePath", range: "literal" },
	// The stepper and action that ran for a step, as `Stepper.action`. The step's text states the request, and this rel states the call.
	CALLED: { rel: "called", uri: "hbn:called", range: "literal" },
	HOST_ID: { rel: "hostId", uri: "hbn:hostId", range: "literal" },
	/** Whether a step ran in this process or on another host. */
	RAN_VIA: { rel: "ranVia", uri: "hbn:ranVia", range: "literal" },
	/** The host that ran a step when another host ran it. */
	RAN_ON: { rel: "ranOn", uri: "hbn:ranOn", range: "literal" },
	ACCESS_LEVEL: { rel: "accessLevel", uri: "hbn:accessLevel", range: "literal", presentation: "governance" as TRelPresentation },
	MEASUREMENT_KIND: { rel: "measurementKind", uri: "hbn:measurementKind", range: "literal" },
	SHAPE_DIGEST: { rel: "shapeDigest", uri: "hbn:shapeDigest", range: "container" },
	OUTCOME_REASON: { rel: "outcomeReason", uri: "hbn:outcomeReason", range: "literal" },
	// EARL: how a test or a goal ended. A record states its goal's verdict in this rel.
	OUTCOME: { rel: "outcome", uri: "earl:outcome", range: "literal" },
	// RDFS terms. Property nodes describe rels with them.
	SUB_PROPERTY_OF: { rel: "subPropertyOf", uri: "rdfs:subPropertyOf", range: "iri" },
	SUB_CLASS_OF: { rel: "subClassOf", uri: "rdfs:subClassOf", range: "iri" },
	LABEL: { rel: "label", uri: "rdfs:label", range: "literal" },
	DESCRIPTION: { rel: "description", uri: "rdfs:comment", range: "literal" },
	// schema.org's domainIncludes and rangeIncludes list the classes a property connects as a union. Several rdfs:domain
	// statements would state their intersection.
	DOMAIN: { rel: "domain", uri: "schema:domainIncludes", range: "iri" },
	RANGE: { rel: "range", uri: "schema:rangeIncludes", range: "iri" },
	ICON: { rel: "icon", uri: "hbn:icon", range: "literal" },
	PRESENTATION: { rel: "presentation", uri: "hbn:presentation", range: "literal" },
	// W3C Security (sec:): controllers, delegation, key material and proofs (DID and zcap-LD vocabulary)
	CONTROLLER: { rel: "controller", uri: "sec:controller", range: "iri" },
	/** An endpoint a principal publishes. A reader reaches the deployment through it. DID Core states a controller's
	 *  services this way. */
	SERVICE: { rel: "service", uri: "did:service", range: "iri" },
	ALLOWED_ACTION: { rel: "allowedAction", uri: "sec:allowedAction", range: "literal", presentation: "governance" as TRelPresentation },
	CAPABILITY_ACTION: { rel: "capabilityAction", uri: "sec:capabilityAction", range: "literal", presentation: "governance" as TRelPresentation },
	PUBLIC_KEY: { rel: "publicKey", uri: "sec:publicKeyMultibase", range: "literal" },
	EXPIRES: { rel: "expires", uri: "sec:expiration", range: "literal" },
	REVOKED: { rel: "revoked", uri: "sec:revoked", range: "literal", presentation: "governance" as TRelPresentation },
	PROOF: { rel: "proof", uri: "sec:proof", range: "iri" },
	// A record's validity window in general haibun-native terms. Any record can carry one, such as a permit, an offer or a
	// certificate. A consumer whose standard names its own validity terms keeps these rels for behaviour and overrides
	// the served IRI per field (TTermPropertyDef).
	VALID_FROM: { rel: "validFrom", uri: "hbn:validFrom", range: "literal" },
	VALID_UNTIL: { rel: "validUntil", uri: "hbn:validUntil", range: "literal" },
	// The role attribution super-property. It is the broad term over every predicate that names the party to which a node is
	// attributed. It is broader than prov:wasAttributedTo because a role target need not be a prov:Agent. An artifact
	// published to a registry groups under that registry, which is a publication target and not an agent. So
	// prov:wasAttributedTo is a sub-property of inRoleOf and not the reverse. The role grouping axis derives its predicate
	// set from every rel declared subPropertyOf inRoleOf (roleRels below) and every consumer edge declared with an actor
	// rel. The ontology determines the set, and a hand-kept array doesn't.
	IN_ROLE_OF: { rel: "inRoleOf", uri: "hbn:inRoleOf", range: "iri", abstract: true },
	// Directional actor super-properties under inRoleOf. A sequence needs the direction, and the grouping axis doesn't.
	// fromActor is the source actor of an entity: its creator, sender or responsible agent. toActor is the destination
	// actor: its subject, recipient, audience or registry. Both are sub-properties of inRoleOf, so every concrete actor rel
	// declared under one is also a role rel, because roleRels derives transitively. The split adds direction and doesn't
	// remove a role rel. An Actor is a prov:Agent ≡ as:Actor ≡ foaf:Agent. Across vocabularies, a sequence reads any entity
	// that carries a fromActor and a toActor as a message from source to target, without per-type rules.
	// Both are abstract. Each is a classification target like inRoleOf and never a written edge label. A consumer's domain
	// declaration uses them as upper ontology pointers. An edge declared `{ rel: "fromActor", iri: "<its own term>" }`
	// classifies under the pointer and serves its own vocabulary IRI, so consumer vocabularies don't appear here.
	FROM_ACTOR: { rel: "fromActor", uri: "hbn:fromActor", range: "iri", subPropertyOf: "inRoleOf", abstract: true },
	TO_ACTOR: { rel: "toActor", uri: "hbn:toActor", range: "iri", subPropertyOf: "inRoleOf", abstract: true },
	// Concrete general actor rels. The graph edge label a stepper writes is the rel string, because the role merge
	// matches the quad predicate against the edge label. Each rel declares its direction (fromActor for the source,
	// toActor for the destination) and its rolePriority. The highest-priority role edge names a node's container or lane
	// when the node carries several. Consumer-declared edges share this view ordering and carry their own rolePriority
	// in their domain declarations.
	PERFORMED_BY: { rel: "performedBy", uri: "prov:wasAssociatedWith", range: "iri", subPropertyOf: "fromActor", rolePriority: 40 },
	AUTHOR: { rel: "author", uri: "schema:author", range: "iri", subPropertyOf: "fromActor", rolePriority: 30 },
	// The general destination actor: the party or point that receives an activity, such as the endpoint a request calls.
	// Consumers declare their own `toActor` rels (recipient, …). A sequence reads it as the lifeline that
	// receives a message.
	AS_TARGET: { rel: "target", uri: "as:target", range: "iri", subPropertyOf: "toActor", rolePriority: 40 },
	// The direct object of an act, such as an edit's file. audience holds the act's addressee and target holds its
	// destination.
	AS_OBJECT: { rel: "object", uri: "as:object", range: "iri", subPropertyOf: "toActor", rolePriority: 50 },
} as const;

/** Every declared relation, keyed by its rel. It is built once because every projected property of every record looks
 *  up its rel, and a lookup would otherwise scan the whole vocabulary. */
const RELATION_BY_REL: ReadonlyMap<string, (typeof LinkRelations)[keyof typeof LinkRelations]> = new Map(Object.values(LinkRelations).map((entry) => [entry.rel, entry]));

/** Returns a rel's RDF range, or undefined for an undeclared rel. */
export function getRelRange(rel: string): TRelRange | undefined {
	return RELATION_BY_REL.get(rel)?.range;
}

/** Returns a rel's declared presentation hint. Clients render a rel that declares one outside the default field table. Other rels render as regular field cells. */
export function getRelPresentation(rel: string): TRelPresentation | undefined {
	return (RELATION_BY_REL.get(rel) as { presentation?: TRelPresentation } | undefined)?.presentation;
}

export type TRel = (typeof LinkRelations)[keyof typeof LinkRelations]["rel"];

/** JSON-LD context mapping: rel → standard URI. Derived from LinkRelations. */
export const REL_CONTEXT: Record<TRel, string> = Object.fromEntries(Object.values(LinkRelations).map(({ rel, uri }) => [rel, uri])) as Record<TRel, string>;

/**
 * Standard edge predicates for graph nodes.
 * Each carries its LinkRelation rel, and predicate→rel resolution reads only this map.
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
	hasBody: { rel: LinkRelations.HAS_BODY.rel },
	mentions: { rel: LinkRelations.MENTIONS.rel },
	hasSource: { rel: LinkRelations.HAS_SOURCE.rel },
	hasSelector: { rel: LinkRelations.HAS_SELECTOR.rel },
	linksTo: { rel: LinkRelations.LINKS_TO.rel },
	used: { rel: LinkRelations.USED.rel },
	wasGeneratedBy: { rel: LinkRelations.WAS_GENERATED_BY.rel },
} as const;

type TEdgePredicate = keyof typeof EdgePredicates;

/** Edge predicate name strings. Use `EDGE.from` instead of `"from"`. */
export const EDGE: { [K in TEdgePredicate]: K } = Object.fromEntries(Object.keys(EdgePredicates).map((k) => [k, k])) as {
	[K in TEdgePredicate]: K;
};

/** Resolves a predicate name to its rel. */
export function edgeRel(predicate: string): TRel | undefined {
	return (EdgePredicates as Record<string, { rel: TRel }>)[predicate]?.rel;
}

/** Returns a rel's declared parents (rdfs:subPropertyOf). A rel may declare more than one upper concept as its parent.
 *  `subPropertyOf` accepts a single rel or an array, and both forms normalise to a list. Returns an empty list when the rel doesn't declare a parent. */
function superPropertiesOf(rel: string): string[] {
	const sp = (RELATION_BY_REL.get(rel) as { subPropertyOf?: string | string[] } | undefined)?.subPropertyOf;
	return sp === undefined ? [] : Array.isArray(sp) ? sp : [sp];
}

/**
 * An RDFS-style ancestry check. Returns true if `rel` is `ancestorRel` or reaches it transitively through
 * `subPropertyOf` links. `subPropertyOf` is many-valued: a rel can be a sub-property of several upper concepts, such as
 * a start-date rel that is both a temporal instant and a gantt start. This walks the parent DAG and not a single chain.
 * It applies to any rel hierarchy, not only reply semantics. The `seen` set ends the walk on a self-referential or
 * cyclic `subPropertyOf` graph.
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
 * Returns whether an edge type (predicate name or rel) is a reply-type link. It walks the `subPropertyOf` chain to
 * `inReplyTo` from the type as a rel, then from the rel that EdgePredicates resolves for the type as a predicate name.
 */
export function isReplyEdge(edgeType: string): boolean {
	const target = LinkRelations.IN_REPLY_TO.rel;
	if (isSubPropertyOf(edgeType, target)) return true;
	const rel = edgeRel(edgeType);
	return rel ? isSubPropertyOf(rel, target) : false;
}

/** Returns the concrete (non-abstract) rels that are transitively `subPropertyOf` `target`. This is the
 *  ontology-derived predicate set for an upper concept. Abstract concepts (inRoleOf, fromActor, toActor) are excluded
 *  because they classify and are never a written edge label. roleRels, fromActorRels and toActorRels call it. */
function concreteSubRelsOf(target: string): ReadonlySet<string> {
	const set = new Set<string>();
	for (const entry of Object.values(LinkRelations)) {
		if ((entry as { abstract?: boolean }).abstract) continue;
		if (isSubPropertyOf(entry.rel, target)) set.add(entry.rel);
	}
	return set;
}

/**
 * Returns the ontology-derived role-attribution predicate set. It holds every core rel that is transitively
 * `subPropertyOf` the broad role super-property `inRoleOf` (performedBy, author, wasAttributedTo, attributedTo, …). A
 * new core role predicate declares `subPropertyOf` in LinkRelations and doesn't need an entry here. A consumer's role
 * predicates don't appear here. They classify through the edges of their domain declarations, whose rel is an actor
 * upper pointer, and the page's catalog derivation merges them with this set. The role merge reads the merged set to assign
 * each node's HypermediaRole (the party it is attributed to) and to form the role containers and swimlanes.
 *
 * The set is unordered. Each entry's declared rolePriority orders a node's role edges when the node carries several.
 * The abstract `inRoleOf` is excluded because it is never a written edge label.
 */
export function roleRels(): ReadonlySet<string> {
	return concreteSubRelsOf(LinkRelations.IN_ROLE_OF.rel);
}

/** Returns the source-side core actor rels (author, performedBy, attributedTo, wasAttributedTo): every concrete core
 *  rel under `fromActor`. Consumer edges such as issuer and holder classify through their domain declarations. A
 *  sequence reads an entity's fromActor as the lifeline that sends a message. */
export function fromActorRels(): ReadonlySet<string> {
	return concreteSubRelsOf(LinkRelations.FROM_ACTOR.rel);
}

/** Returns the target-side actor rels: every concrete core rel under `toActor`. Consumer edges classify through their
 *  domain declarations. A sequence reads an entity's toActor as the lifeline that receives a message. */
export function toActorRels(): ReadonlySet<string> {
	return concreteSubRelsOf(LinkRelations.TO_ACTOR.rel);
}

// ============================================================================
// Hypermedia topology: how a stepper declares a persisted type
// ============================================================================

/**
 * A content property definition. The plain-string form (`TRel`) declares only a property's rel. The object form
 * declares a content-shaped property: its rel, the media type of the form of text it holds and an optional `kind`. The
 * writer partitions such fields from the parent into Body sub-resources linked through hasBody at upsert time.
 *
 * The object form keeps each content field's declaration in one place. It matches the JSON-LD model, where mediaType
 * is data on the Body resource and not on the parent's stored state.
 *
 * `kind` names one Body of the parent, and a field without `kind` holds a form of the parent's one Body. The content fields
 * of one kind are the forms of one text, each in its own media type, such as an email's plain part, its HTML part and the
 * markdown converted from the HTML. The Body's text is the form `BODY_PREFERENCE` orders first, and its other forms are its
 * representations. Two texts are two kinds, such as a tool call's parameters and its result.
 */
type TContentPropertyDef = { rel: "content"; mediaType: string; kind?: string; iri?: string };

/**
 * A property whose vocabulary IRI isn't its rel's default. The rel still determines behaviour (sort, facet,
 * presentation). The served `@context` maps the field to `iri`, so a standards-conformant field carries its own term
 * instead of the placeholder IRI of a catch-all rel. For example, a consumer field `dueDate` maps to `ex:dueDate` under
 * the consumer's declared prefix. `iri` is a CURIE whose prefix the context declares (topology.namespaces).
 */
export type TTermPropertyDef = { rel: TRel; iri: string };

export type TPropertyDef = TRel | TContentPropertyDef | TTermPropertyDef;

export function isContentPropertyDef(def: TPropertyDef | undefined): def is TContentPropertyDef {
	return typeof def === "object" && def !== null && def.rel === "content";
}

/** Returns the vocabulary IRI a property declares (TTermPropertyDef), or undefined where it doesn't declare one and its rel's IRI applies. */
export function propertyIriOf(def: TPropertyDef | undefined): string | undefined {
	return typeof def === "object" && def !== null && "iri" in def ? def.iri : undefined;
}

/** Returns the types an edge's range lists. */
export const edgeRanges = (edge: { range: string | string[] }): string[] => (Array.isArray(edge.range) ? edge.range : [edge.range]);

/** An edge definition and its target node type. The rel resolves from EdgePredicates[key]. A domain-specific edge
 *  outside the standard set states an explicit rel. A consumer vocabulary's edge declares an upper ontology pointer as
 *  its rel, such as `fromActor` or `toActor`, and `iri` carries its own term. The edge key is the written edge label,
 *  the rel classifies it and the iri serves it. `rolePriority` orders actor edges when a node carries several, and the
 *  highest names its container or lane. It uses the same scale as the core rels' declared rolePriority. */
export type TEdgeDef = {
	/** The edge's target type, or each type it may target where it has more than one. */
	range: string | string[];
	rel?: TRel;
	iri?: string;
	rolePriority?: number;
	label?: string;
	/** The noun that names this edge's target party: `X issuer→ P` makes P an "Issuer". A view reads it from the
	 *  projection, so the edge that gives a party its role also declares the role's name. */
	roleNoun?: string;
	/** Set where the edge's target may be absent when a record is written. A store writes such an edge to a reference. */
	reference?: boolean;
};

/**
 * Per-property domain ranges. Each entry maps a schema field name to another registered domain key and declares that
 * the field's values range over instances of that domain. This is haibun's equivalent of SHACL's `sh:node` and RDFS's
 * `rdfs:range`. It states the kind of value a property carries. The goal resolver reads it to decompose composite
 * inputs into their typed component goals, and the chain view reads it to emit field nodes.
 *
 * It differs from `THypermediaTopology.edges`. Edges declare outgoing graph edges keyed by predicate name, with their
 * own rel and range. Ranges annotate the scalar and nested-object schema fields that `properties` lists with their
 * declared domain. The resolver treats a field without a ranges entry as primitive and resolves it to an `argument`
 * binding.
 */
type TDomainRanges = Record<string, string>;

/**
 * The hypermedia topology that describes a persisted domain. `persistedAs`, `id` and `properties` are required
 * together. The hypermedia builder validates them, such as the presence of an identifier rel and a published rel.
 */
export type THypermediaTopology = {
	persistedAs: string;
	/** The standard class the type's records are members of, such as `prov:Entity`. The served JSON-LD names the type's own class
	 *  `hbn:<persistedAs>` and states this IRI as its superclass, since several types declare one IRI. */
	type?: string;
	/**
	 * The @context prefix→IRI bindings this type's vocabulary needs beyond the standard prefixes and haibun's own that
	 * core declares. A consumer whose @type or rel IRI uses `foo:Bar` declares `foo` here. getJsonLdContext merges it into
	 * the served context.
	 */
	namespaces?: Record<string, string>;
	/**
	 * The published standard @context documents this type conforms to, as absolute URLs. The served type-scoped
	 * @context references them as a JSON-LD 1.1 array. The URLs come first and this type's own field terms last, so
	 * haibun's definitions take precedence on a collision and the type's full standard vocabulary is expressible. The
	 * schema-graph projection enumerates their terms to show every property a conforming instance may carry and marks
	 * each one that is absent from the data.
	 */
	standardContexts?: string[];
	/**
	 * rdfs:subClassOf: the superclass IRIs of this type. The served JSON-LD states each on the type's class node in
	 * `@graph`, so the type's class entails them. The single-string `@type` carries only the bare label, one navigable
	 * type. A second standards class that a node must satisfy is declared here as an RDFS axiom and doesn't make `@type`
	 * multi-valued. An example is a `sec:Issuer` or `sec:Controller` that is the target of `prov:wasAttributedTo`
	 * (range `prov:Agent`).
	 */
	subClassOf?: string | string[];
	id: string;
	properties: Record<string, TPropertyDef>;
	edges?: Record<string, TEdgeDef>;
	/** Per-property ranges (sh:node / rdfs:range). See TDomainRanges. */
	ranges?: TDomainRanges;
	/** DB-specific: the sortable columns, each with its SQL type. */
	sortColumns?: Record<string, string>;
	/**
	 * Whether writing a record of this type emits an observation of the quads it holds. A type whose records are the
	 * record of an event already emitted declares false, because emitting the write would repeat that event to the
	 * reader. A message that actuality logged reaches a reader as the log event. Its record is the durable copy of that
	 * statement and not a second occurrence. Absent means the write is emitted, which a record needs when its write is
	 * the only event that reports it.
	 */
	announceWrites?: boolean;
	/**
	 * Whether the type records actuality itself and not a feature's data. A step path, a log line and an HTTP
	 * exchange are examples. A search for a reader's records doesn't read the type. A conversation's context excludes
	 * its records. A view hides it until a reader shows it. Absent means a feature's data.
	 */
	instrumentation?: boolean;
	/**
	 * Whether the type's named graph is complete: its records are every record of the type, so the reasoner states them as
	 * one formula and a rule's scoped negation (`log:notIncludes`) over it is a closed check. Absent means the graph is open,
	 * where a claim the records don't prove is unknown.
	 */
	complete?: boolean;
	/**
	 * The fields a store counts an instrumentation type's records by, each day, as it removes the records older than its
	 * retention: the fields the density reads group and filter by, so a rail still marks a day whose records are removed.
	 * Absent means the store counts the records of each day by their type alone.
	 */
	countedBy?: readonly string[];
	/**
	 * The level a record of this type is stored at when the record doesn't state one. A type declares the least sharing
	 * under which its records remain useful, so a writer that omits the level doesn't publish a record. A record shared
	 * more widely states its level on the record itself. Registration refuses a persisted type that doesn't state it.
	 */
	accessLevel: AccessLevel;
	/**
	 * Where core holds the records of a type that core writes or derives. A backing store registers each persisted type
	 * that doesn't state `heldBy`. `in-memory store` states that core's in-memory store holds the records. `declarations`
	 * states that core derives the records from the declarations and rejects a write.
	 */
	heldBy?: THeldBy;
	/** The default sort field when a query doesn't specify one. It must be one of this type's sort columns. Declare it for a type whose event or content time differs from its record creation time, such as an email's received time and its import time. Queries sort by generatedAtTime where a type doesn't declare it. */
	defaultSort?: string;
	/**
	 * The property or edge that titles records of this type. It is the vocabulary's labelling property, as foaf:name or
	 * dcterms:title labels its own type. Declare it for a type that titles itself through a term of its own vocabulary and
	 * not through the cross-domain rdfs:label, as:name or content that `DISPLAY_LABEL_SHARED` (hypermedia.ts) resolves.
	 * An oa:TextQuoteSelector is the passage it quotes (oa:exact) and doesn't have a name.
	 *
	 * A property titles the record by its value, and a list by its members. An edge titles the record by the title of its
	 * target record. A record that stands for another is titled this way: an oa:SpecificResource by the passage its
	 * selector locates, and a verdict by the record it checked. A record titled through a second record that is titled
	 * through a third takes the third record's title. An explicit rdfs:label on an individual takes precedence. This field
	 * sets the type's title and doesn't replace a label a reader gave.
	 */
	displayLabel?: string;
	/**
	 * The calls each record of this type offers, keyed by the rel that names each call. Each call states the step's
	 * method, the parameter that takes the record and what the call does. The store attaches each call as a link to every
	 * record it reads. A reader follows the link as it follows the record's `self`, and a view offers the link by its
	 * summary.
	 */
	links?: Record<string, TOfferedCall>;
};

/** Where core holds the records of a type that core writes or derives (`THypermediaTopology.heldBy`). */
export const HELD_BY = { inMemoryStore: "in-memory store", declarations: "declarations" } as const;
export type THeldBy = (typeof HELD_BY)[keyof typeof HELD_BY];

/** A call each record of a type offers: the step's method, the parameter that takes the record, and what the call does. */
export type TOfferedCall = { method: string; param: string; summary: string };

/**
 * A lightweight topology for a non-persisted domain whose fields range over registered persisted domains. Step input
 * composite shapes typically use it. It carries only `ranges`. The hypermedia builder skips it, and only the resolver
 * reads it.
 */
type TRangesTopology = {
	ranges: TDomainRanges;
	/** A ranges-only topology doesn't declare `persistedAs`, and the absent key distinguishes it from a hypermedia topology. */
	persistedAs?: never;
};

/**
 * A domain topology is either a full hypermedia topology or a lightweight ranges-only declaration. Partial persisted
 * fields without a persistedAs are invalid, and the type system rejects them.
 */
export type TDomainTopology = THypermediaTopology | TRangesTopology;

/** Returns true when a domain's topology states persistedAs. */
/** The field a type's records are sorted by where a query doesn't state one: the field it declares, or the time each was generated. */
export const sortFieldOf = (topology: { defaultSort?: string }): string => topology.defaultSort ?? LinkRelations.GENERATED_AT_TIME.rel;

export function isPersisted(topology: TDomainTopology | undefined): topology is THypermediaTopology {
	return !!topology && "persistedAs" in topology && typeof topology.persistedAs === "string";
}

/** Returns the level a type's records are written at when a record doesn't state one. That is the level its topology
 *  declares. A name that isn't a persisted type doesn't declare one and returns undefined. */
export function declaredAccessLevel(domain: TRegisteredDomain & { topology: THypermediaTopology }): AccessLevel;
export function declaredAccessLevel(domain: TRegisteredDomain | undefined): AccessLevel | undefined;
export function declaredAccessLevel(domain: TRegisteredDomain | undefined): AccessLevel | undefined {
	const topology = domain?.topology;
	return isPersisted(topology) ? topology.accessLevel : undefined;
}

/** The domain name for type labels. Registered persisted domains populate it. */
export const DOMAIN_PERSISTED_TYPE = "persisted-type";

// ============================================================================
// Domain registration shape
// ============================================================================

/** Where a value is coerced: the seqPath of the step it fills, the path of the feature that states it, and the steppers. A
 *  call from a transport doesn't have a feature, so its path is undefined. */
export type TCoercionSite = { seqPath: import("./protocol.js").TSeqPath; path: string | undefined; steppers: import("../steps/domains/stepper.js").AStepper[] };

/** Parses a step value, or another proto, into the domain's native representation. A domain whose value depends on the
 *  step it fills, as `statement`'s does, reads the site. */
type TDomainCoercer = (proto: import("./protocol.js").TStepValue, site?: TCoercionSite) => import("./protocol.js").TStepValueValue;

/** Comparator between two coerced domain values. */
type TDomainComparator = (value: import("./protocol.js").TStepValueValue, baseline: import("./protocol.js").TStepValueValue) => number;

export type TDomainDefinition = {
	selectors: string[];
	schema: z.ZodType;
	coerce?: TDomainCoercer;
	comparator?: TDomainComparator;
	values?: string[];
	/** Whether a word names a member of a domain whose members are the registered entries. The members are too many to
	 *  list in a step's description, so this function checks a bare word and `values` doesn't. */
	names?: (term: string) => boolean;
	/** Whether its value is the term its line writes and not a variable or an environment value the term names. */
	written?: boolean;
	/** Whether each `{name}` in its written term is given the value `name` resolves to, as a variable's name is. */
	filled?: boolean;
	/** Returns why a term a line writes isn't a value of this domain, with what to write in its place, or undefined where it is
	 *  one. The resolver calls it as a line resolves, so a line that writes a refused term doesn't resolve. */
	refuses?: (term: string, steppers: readonly import("../steps/domains/stepper.js").AStepper[]) => string | undefined;
	/** Returns a term a line writes in the notations a reader checks it by, such as a formal notation and a plain-English
	 *  reading. Validating a line returns each reading, which the step input shows beside the line. */
	reading?: (term: string) => string;
	/** Returns the terms that complete a term a line writes, such as the names that begin with its last word. Validating a
	 *  line whose term this domain refuses returns them, which the step input offers in place of the term. */
	completions?: (term: string) => string[];
	/** Returns what a step's record states in place of a value of this domain. It applies to a value too large to repeat
	 *  in a step's line, events and record, such as a file's bytes. */
	recordedAs?: (value: unknown) => string;
	description: string;
	/** The stepper that registered this domain. registerDomains sets it. */
	stepperName?: string;
	/** The hypermedia topology (label, id, property rels, edges, indexes) or a ranges-only topology. Undefined for a domain that doesn't declare a topology. */
	topology?: TDomainTopology;
	/** UI metadata such as slot, component and JS source. Hypermedia renderers such as the SHU SPA read it. */
	ui?: Record<string, unknown>;
	/** The list its products hold, for a domain whose products hold one, which the list combinators read. */
	list?: TListDeclaration;
};

/** A domain as registration holds it. Registration supplies a coercer from the schema where the definition doesn't state one. */
export type TRegisteredDomain = TDomainDefinition & { coerce: TDomainCoercer };

// ============================================================================
// Comment schema + domain definition
// ============================================================================

/**
 * A Comment is a free-text annotation attached to any Resource. COMMENT_LABEL and COMMENT_DOMAIN near the top of this
 * file declare its vocabulary consts.
 *
 * The edge predicate expresses the speech act as a discourse rel (a sub-property of inReplyTo), and the node doesn't
 * carry a `discourse` property.
 *
 * `author` identifies who made the comment. It is a required URI string such as "user:alice", "stepper:llm" or
 * "llm:gpt-x", so every Comment is attributed. Structured-Actor hydration is a query-time projection and isn't stored.
 */
// Persisted schemas don't use strict mode, so they accept extra fields. Callers attach edge-construction rels
// (`discourse`, `inReplyTo`, …) that upsertIndividual's partition step writes as edges and not as the individual's
// properties. Strict mode would reject those fields before the partition runs.
export const CommentSchema = PersistedVertexSchema.extend({
	id: z.string(),
	author: z.string(),
	generatedAtTime: z.string(),
	/** The start of the period the note describes, such as a milestone's week or a summarized span. This subject time
	 *  differs from `generatedAtTime`, which holds the time the record was written. Time-placed views such as gantt read it. */
	startedAtTime: z.string().optional(),
	/** The end of the period the note describes. Time-placed views read a note with both `startedAtTime` and this field
	 *  as an interval. A start without an end reads as an instant milestone. */
	endedAtTime: z.string().optional(),
	seqPath: z.string().optional(),
	body: z.string().optional(),
	/** A short display name: the note's own text, truncated. The body is partitioned into a Body sub-resource, so a
	 *  Comment node without `name` is titled by its id. `name` lets a graph view show the note's text. */
	name: z.string().optional(),
	/** The handles the note states that its source records don't hold, such as records a model response names that the
	 *  model wasn't sent. A reader of the note treats those records as the note's own and not as records the graph holds. */
	unverified: z.array(z.string()).optional(),
});

export type TComment = z.infer<typeof CommentSchema>;

/** A registered route as a graph vertex. The web server persists it at mount. Observed requests target it, and the
 *  principal that serves it publishes it. */
export const ENDPOINT_LABEL = "Endpoint";
/** The endpoint classes: a page route of this site, a service route of the app (/rpc, /sse), or another host. */
export const ENDPOINT_CLASS = { route: "route", service: "service", external: "external" } as const;
/** The type of every observed HTTP request and the only network-interaction record. Its `performedBy` and `target`
 *  edges make it a message in the polymorphic view's sequence view. */
export const HTTP_REQUEST_LABEL = "HttpRequest";
/** The requesting party: the browser / user agent. A singleton lifeline with id `client`. */
export const HTTP_CLIENT_LABEL = "HttpClient";
/** A serving party: the site itself or an external server. Each host has one node that carries `requestCount`.
 *  `requestCount` counts the requests that reached the host. It is a rollup of the host's HttpRequests and isn't
 *  tracked separately. */
export const HTTP_HOST_LABEL = "HttpHost";

export const PRINCIPAL_LABEL = "Principal";
/** The domain selector. It differs from the runtime "principal" key (see lib/principal.ts) to avoid a collision. */
export const PRINCIPAL_DOMAIN = "principal-individual";

/** The Comment's topology. It uses existing LinkRelations for every property and doesn't introduce rels. A Comment's write
 *  names its Body by the Body its `body` field declares. */
export const COMMENT_TOPOLOGY: THypermediaTopology = {
	persistedAs: COMMENT_LABEL,
	accessLevel: Access.private,
	// A Comment carries oa:hasBody and oa:hasTarget in the W3C Web Annotation shape. The class relationship is an
	// RDFS axiom and doesn't make @type multi-valued.
	subClassOf: "oa:Annotation",
	id: "id",
	properties: {
		id: LinkRelations.IDENTIFIER.rel,
		name: LinkRelations.NAME.rel,
		author: LinkRelations.ATTRIBUTED_TO.rel,
		startedAtTime: LinkRelations.STARTED_AT_TIME.rel,
		endedAtTime: LinkRelations.ENDED_AT_TIME.rel,
		seqPath: LinkRelations.SEQ_PATH.rel,
		body: { rel: LinkRelations.CONTENT.rel, mediaType: MEDIA_TYPE.markdown },
		unverified: LinkRelations.TAG.rel,
		// The conversation a comment is part of, by the id of its first question. A read of a conversation filters
		// comments by this field.
		[LinkRelations.CONTEXT.rel]: LinkRelations.CONTEXT.rel,
	},
	edges: {
		[HAS_BODY_EDGE]: { rel: LinkRelations.HAS_BODY.rel, range: BODY_LABEL },
		// The author as a navigable edge to that agent. A comment links to the person, service or model that wrote it
		// and doesn't only name it in a string. The edge ranges over Principal, which is a sec:Controller and a
		// prov:Agent, so every kind of author is well-formed against it. The property with the same rel remains
		// because author is a sort and filter column.
		[LinkRelations.ATTRIBUTED_TO.rel]: { rel: LinkRelations.ATTRIBUTED_TO.rel, range: PRINCIPAL_LABEL },
		// The comment's subject: any Resource, such as an entity or another Comment in a thread.
		[LinkRelations.TARGET.rel]: { rel: LinkRelations.TARGET.rel, range: RESOURCE_LABEL },
		// The comment's addressee (as:to, the rel an email's recipients carry). A question addresses the agent expected
		// to respond. A response addresses the person who asked. A decision addresses the party that requested it. This
		// edge and attributedTo let a view read a discourse as messages between agents. oa:hasTarget holds the
		// comment's subject.
		[LinkRelations.AUDIENCE.rel]: { rel: LinkRelations.AUDIENCE.rel, range: RESOURCE_LABEL },
		// The record the comment carries: a petition carries the proposal it requests, and a measure carries its
		// observation. The edge is declared so a view can follow it to the carried record.
		[LinkRelations.ATTACHMENT.rel]: { rel: LinkRelations.ATTACHMENT.rel, range: RESOURCE_LABEL },
		// A linking annotation's cross-reference: the note points at another SpecificResource (a section) in the source.
		[LinkRelations.LINKS_TO.rel]: { rel: LinkRelations.LINKS_TO.rel, range: SPECIFIC_RESOURCE_LABEL },
		...Object.fromEntries(DISCOURSE_RELS.map((r) => [r, { rel: r, subPropertyOf: LinkRelations.IN_REPLY_TO.rel, range: COMMENT_LABEL }])),
	},
	sortColumns: { author: "TEXT", seqPath: "TEXT" },
};

/** The Comment domain definition. Register it in a stepper's `getConcerns().domains` to expose Comment as a graph node. */
export const commentDomainDefinition: TDomainDefinition = {
	selectors: [COMMENT_DOMAIN],
	schema: CommentSchema,
	description: "A note about another record. It links to its subject and to any replies, so a conversation stays attached to its subject.",
	topology: COMMENT_TOPOLOGY,
};

// ============================================================================
// Principal schema + domain definition
// ============================================================================

/**
 * A Principal is a standards-based identity in the graph (W3C DID and the Security `sec:` vocabulary). The acting
 * identity is a DID string, such as a Comment's `author` or an artifact's creator. A Principal node is its persisted
 * public descriptor. A principal's permissions aren't a property of it. The delegations that name it as controller
 * grant them, and a consumer records those delegations as its own capabilities.
 *
 * Comment→Principal authorship uses a shared DID: `Comment.author` (a string) equals `Principal.id`, and
 * a read of the Principal named `comment.author` returns it. The Comment topology also declares an attributedTo edge to
 * the Principal.
 *
 * Only public material persists, and the schema doesn't have a private-key field.
 */

const PrincipalSchema = PersistedVertexSchema.extend({
	id: z.string(),
	/** as:name: an optional human-readable name for this Principal, which a DID doesn't carry. It titles a party by a readable name instead of its DID and resolves as the display headline after rdfs:label. The field is `name` and not `label` because `label` is a reserved column name in a graph store, and `name` is a queryable column. */
	name: z.string().optional(),
	controller: z.string().optional(),
	publicKey: z.string().optional(),
	generatedAtTime: z.string(),
});

export type TPrincipal = z.infer<typeof PrincipalSchema>;
/** A Principal record as a typed read reads it: its type, and the schema its domain registers. */
export const PrincipalRecord = { label: PRINCIPAL_LABEL, schema: PrincipalSchema } satisfies TRecordType<z.ZodType>;

/** A principal as a row reads it: its DID, and the key it signs with where it declares one. */
export type TPrincipalRow = { id: string; publicKey?: string };

/** Returns a principal record's row. Throws for a record that isn't a principal's. */
export function principalRow(record: Record<string, unknown>): TPrincipalRow {
	const { id, publicKey } = PrincipalSchema.parse(record);
	return publicKey === undefined ? { id } : { id, publicKey };
}

/** The address of the principal `id` names, which a reference opens. */
export const principalAddress = (id: string): { persistedAs: string; id: string } => ({ persistedAs: PRINCIPAL_LABEL, id });

/** The graph query of the principals actuality holds. */
export const principalsQuery = (): { label: string } => ({ label: PRINCIPAL_LABEL });

/**
 * The Principal domain definition. Register it in a stepper's `getConcerns().domains` to expose Principal as a graph
 * node. `generatedAtTime` is required because buildConcernCatalog (hypermedia.ts) rejects a persisted domain whose
 * GENERATED_AT_TIME-rel field is optional.
 *
 * `controller` is a plain property. Every persist path sets `controller === id` because a Principal controls itself,
 * and a self-referential edge doesn't add a useful link. It stays a scalar in `properties` and `sortColumns`.
 */
export const principalDomainDefinition: TDomainDefinition = {
	selectors: [PRINCIPAL_DOMAIN],
	schema: PrincipalSchema,
	// This description defines a DID for a reader because a Principal's identity is a DID. Other descriptions link the
	// word here and don't explain it again.
	description:
		"A person or service that acts in this system: the author of records, comments and decisions. Each is identified by a DID. A DID is a decentralized identifier: a stable web address of its own (written did:…) that anyone can look up to find the keys with which it signs. A central directory doesn't assign these identities.",
	topology: {
		persistedAs: PRINCIPAL_LABEL,
		type: "sec:Controller",
		// A Principal is the responsible agent every persisted node is attributed to (prov:wasAttributedTo, range
		// prov:Agent). Declaring sec:Controller a kind of prov:Agent makes that attribution well-formed against the rel's range.
		subClassOf: PROV_AGENT,
		id: "id",
		accessLevel: Access.public,
		properties: { id: LinkRelations.IDENTIFIER.rel, name: LinkRelations.NAME.rel, controller: LinkRelations.CONTROLLER.rel, publicKey: LinkRelations.PUBLIC_KEY.rel },
		edges: { service: { rel: LinkRelations.SERVICE.rel, range: ENDPOINT_LABEL } },
		sortColumns: { name: "TEXT", controller: "TEXT", generatedAtTime: "TIMESTAMPTZ" },
	},
};

// ============================================================================
// Body schema + domain definition
// ============================================================================

/** One form of a Body's text other than the form its `content` holds: its media type and its text. */
export const RepresentationSchema = z.object({ mediaType: z.string(), content: z.string() });
export type TRepresentation = z.infer<typeof RepresentationSchema>;

/**
 * A Body holds opaque content with a declared media type. Any resource links it through `hasBody`. The format is data
 * on the Body and not metadata on the parent resource's topology, so JSON-LD round-trips and graph queries read
 * mediaType as a triple.
 *
 * A Body's `content` is its text in `mediaType`: the form a reader reads first. `representations`
 * holds each other form of the same text, such as the HTML part of an email whose text is the markdown converted from it.
 * A search indexes the text of every form, and a reader that forwards the text sends its maximal text (`body-text.ts`).
 * A Body without `representations` holds one form. The Body schema has the same constraint as Comment: parent nodes supply
 * content fields that the partition step extracts before persistence.
 */
export const BodySchema = PersistedVertexSchema.extend({
	id: z.string(),
	content: z.string(),
	mediaType: z.string(),
	generatedAtTime: z.string(),
	representations: z.array(RepresentationSchema).optional(),
});

export type TBody = z.infer<typeof BodySchema>;

export const bodyDomainDefinition: TDomainDefinition = {
	selectors: [BODY_DOMAIN],
	schema: BodySchema,
	description: "The full content of another record, such as a message's text or a document's data. It is stored beside the record, so large content loads only when opened.",
	topology: {
		persistedAs: BODY_LABEL,
		accessLevel: Access.private,
		id: "id",
		properties: {
			id: LinkRelations.IDENTIFIER.rel,
			content: LinkRelations.CONTENT.rel,
			mediaType: LinkRelations.MEDIA_TYPE.rel,
			representations: { rel: LinkRelations.TAG.rel, iri: "schema:encoding" },
		},
		// The declared query surface for the one-path graph-store. Callers can filter or sort Body rows by mediaType,
		// such as "all PDF bodies", or by generatedAtTime.
		sortColumns: { mediaType: "TEXT", generatedAtTime: "TIMESTAMPTZ" },
	},
};

// ============================================================================
// Web Annotation target schemas + domain definitions (W3C Web Annotation Data Model)
// ============================================================================

/**
 * A TextQuoteSelector locates a segment of a source document by quoting it (oa:exact). The text immediately before
 * (oa:prefix) and after (oa:suffix) optionally disambiguates it. The anchor depends on content, so it remains valid
 * after re-import and re-rendering of the source, where byte offsets wouldn't.
 */
const TEXT_QUOTE_SELECTOR_DOMAIN = "text-quote-selector";

/**
 * A passage located by quoting it, with a Web Annotation TextQuoteSelector's fields. The text around it optionally
 * disambiguates it. The schema declares the three fields once because a link parse, a step's validation, a persisted
 * selector and the SPA all read them. Separate copies in each place would diverge one field at a time.
 */
export const QuoteAnchorSchema = z.object({
	exact: z.string().describe("The verbatim passage the anchor quotes."),
	prefix: z.string().optional().describe("Verbatim text immediately before the passage, disambiguating a repeated quote."),
	suffix: z.string().optional().describe("Verbatim text immediately after the passage, disambiguating a repeated quote."),
});
export type TQuoteAnchor = z.infer<typeof QuoteAnchorSchema>;

/** A note anchored in a record, as the annotations step returns it: the quote that locates it, its body, its provenance,
 *  and the quotes of the sections a linking note links. */
export const AnnotationViewSchema = z.object({
	commentId: z.string(),
	author: z.string().optional(),
	generatedAtTime: z.string().optional(),
	startedAtTime: z.string().optional(),
	endedAtTime: z.string().optional(),
	body: z.string().optional(),
	...QuoteAnchorSchema.shape,
	specificResourceId: z.string(),
	links: z.array(QuoteAnchorSchema).optional(),
});
export type TAnnotationView = z.infer<typeof AnnotationViewSchema>;

/** The notes anchored in a record, and how many there are. */
export const AnnotationListSchema = z.object({ annotations: z.array(AnnotationViewSchema), total: z.number() });

/** A part of a record: a passage it quotes, or a fragment of its media. */
export const PartSchema = z.union([FragmentSchema, QuoteAnchorSchema]);
export type TPart = z.infer<typeof PartSchema>;

export const TextQuoteSelectorSchema = QuoteAnchorSchema.extend({ ...PersistedVertexSchema.shape, id: z.string(), generatedAtTime: z.string() });
/** The edge from an anchor to the reading that wrote it. */
const GENERATED_BY_READING = { rel: LinkRelations.WAS_GENERATED_BY.rel, range: READING_LABEL };

export const textQuoteSelectorDomainDefinition: TDomainDefinition = {
	selectors: [TEXT_QUOTE_SELECTOR_DOMAIN],
	schema: TextQuoteSelectorSchema,
	description: "The quoted text that anchors an annotation at one place inside a document, with optional surrounding text that disambiguates the match.",
	topology: {
		persistedAs: TEXT_QUOTE_SELECTOR_LABEL,
		accessLevel: Access.private,
		type: "oa:TextQuoteSelector",
		id: "id",
		properties: { id: LinkRelations.IDENTIFIER.rel, exact: LinkRelations.EXACT.rel, prefix: LinkRelations.PREFIX.rel, suffix: LinkRelations.SUFFIX.rel },
		// The reading that wrote the selector, which a later reading of the same text retracts.
		edges: { wasGeneratedBy: GENERATED_BY_READING },
		// The quote is the labelling property and isn't mapped to CONTENT.rel. The selector doesn't have content, and
		// stating the quote as its content would serialize a false statement.
		displayLabel: "exact",
		sortColumns: { exact: "TEXT" },
	},
};

const FRAGMENT_SELECTOR_DOMAIN = "fragment-selector";
export const FragmentSelectorSchema = FragmentSchema.extend({ ...PersistedVertexSchema.shape, id: z.string(), generatedAtTime: z.string() });
export const fragmentSelectorDomainDefinition: TDomainDefinition = {
	selectors: [FRAGMENT_SELECTOR_DOMAIN],
	schema: FragmentSelectorSchema,
	description: "The fragment of a document's or media's address that locates a part of it: a PDF's page, a span of audio or video, a region of an image.",
	topology: {
		persistedAs: FRAGMENT_SELECTOR_LABEL,
		accessLevel: Access.private,
		type: "oa:FragmentSelector",
		id: "id",
		properties: { id: LinkRelations.IDENTIFIER.rel, value: LinkRelations.VALUE.rel, conformsTo: LinkRelations.CONFORMS_TO.rel },
		edges: { wasGeneratedBy: GENERATED_BY_READING },
		displayLabel: "value",
		sortColumns: { value: "TEXT" },
	},
};

/**
 * A SpecificResource is the part of a document an annotation describes (W3C Web Annotation "Specific Resource").
 * oa:hasSource names the whole document and oa:hasSelector names the segment. An annotating Comment's oa:hasTarget
 * points at it instead of at the whole document. The document isn't edited, annotations attach from outside, and a view
 * resolves the selector against the document's content when it renders.
 *
 * The model defines it as a proxy for a passage that is serialized inline and never dereferenced, and it doesn't give
 * oa:SpecificResource a title property. Its subject id is a storage artifact and not an identity. It is titled through
 * oa:hasSelector by the passage its selector locates (see `displayLabel` below) unless it carries an rdfs:label.
 */
const SPECIFIC_RESOURCE_DOMAIN = "specific-resource";

export const SpecificResourceSchema = PersistedVertexSchema.extend({
	id: z.string(),
	generatedAtTime: z.string(),
	/** `rdfs:label`: the name a reader gave this passage where it was referenced. The W3C model doesn't give a
	 *  SpecificResource a title of its own. Without a label it reads as the bare text it quotes, such as a clause number or
	 *  a fragment, which doesn't state the reason for the citation. RDFS's labelling property is the standard place for that text. */
	label: z.string().optional(),
});
export const specificResourceDomainDefinition: TDomainDefinition = {
	selectors: [SPECIFIC_RESOURCE_DOMAIN],
	schema: SpecificResourceSchema,
	description: "A place inside a document: the document and the selection that locates the place. A note can point at one passage instead of the whole document.",
	topology: {
		persistedAs: SPECIFIC_RESOURCE_LABEL,
		accessLevel: Access.private,
		type: "oa:SpecificResource",
		id: "id",
		properties: { id: LinkRelations.IDENTIFIER.rel, label: LinkRelations.LABEL.rel },
		edges: {
			hasSource: { rel: LinkRelations.HAS_SOURCE.rel, range: RESOURCE_LABEL },
			hasSelector: { rel: LinkRelations.HAS_SELECTOR.rel, range: [TEXT_QUOTE_SELECTOR_LABEL, FRAGMENT_SELECTOR_LABEL] },
			wasGeneratedBy: GENERATED_BY_READING,
		},
		// Titled through its selector where the individual doesn't carry an rdfs:label.
		displayLabel: "hasSelector",
	},
};

// ============================================================================
// Reading: the record of one reading of a text
// ============================================================================

/** One reading: what it read, when, in which step, and the statements it made. */
export const ReadingSchema = PersistedVertexSchema.extend({
	id: z.string(),
	generatedAtTime: z.string(),
	seqPath: z.string().optional(),
	/** Each statement this reading asserted. A later reading retracts these statements. See `TStatedRecord`. */
	stated: z.array(z.string()),
});
export type TReading = z.infer<typeof ReadingSchema>;

export const readingDomainDefinition: TDomainDefinition = {
	selectors: [READING_DOMAIN],
	schema: ReadingSchema,
	description: "One reading of a text that turned its links into facts. It names the text it read and the step that read it, so every stated fact names its source.",
	topology: {
		persistedAs: READING_LABEL,
		accessLevel: Access.private,
		instrumentation: true,
		type: PROV_ACTIVITY,
		id: "id",
		properties: { id: LinkRelations.IDENTIFIER.rel, seqPath: LinkRelations.SEQ_PATH.rel, stated: LinkRelations.STATED.rel },
		edges: { used: { rel: LinkRelations.USED.rel, range: RESOURCE_LABEL } },
		sortColumns: { generatedAtTime: "TIMESTAMPTZ" },
	},
};

// ============================================================================
// Scene: a named view, saved and applied
// ============================================================================

/**
 * A Scene is a named record of a view's setup, so a way of looking at the graph can be saved, named, linked and
 * restored. It holds the durable options that the view persists across reloads, keyed by the element that owns them.
 * The options are opaque here. Only the view holds its own schema, and the view validates the options when the scene is
 * applied.
 *
 * A scene is an ordinary individual, so `#Scene:name` is a reference like any other. A document can link a requirement
 * to the scene that shows it.
 */
export const SCENE_LABEL = "Scene";
const SCENE_DOMAIN = "scene";

const SceneSchema = PersistedVertexSchema.extend({
	id: z.string().describe("The scene's name. A reader selects the scene by this name, and a link to the scene names it."),
	generatedAtTime: z.string(),
	/** The views' options as JSON, keyed by element tag: `{"shu-polymorphic-graph-view": {…}}`. The graph treats them as opaque, and each view validates its own options on apply. */
	state: z.string(),
});
export type TScene = z.infer<typeof SceneSchema>;

export const sceneDomainDefinition: TDomainDefinition = {
	selectors: [SCENE_DOMAIN],
	schema: fromJsonText(SceneSchema),
	description: "A named way of looking at the graph: which kinds are shown, how they are laid out, and when. It is saved so a reader can reopen it and link it.",
	topology: {
		persistedAs: SCENE_LABEL,
		accessLevel: Access.private,
		id: "id",
		// Its id is its name.
		displayLabel: "id",
		properties: { id: LinkRelations.IDENTIFIER.rel, state: LinkRelations.SCHEMA_OBJECT.rel },
		sortColumns: { generatedAtTime: "TIMESTAMPTZ" },
	},
};

export const ANNOTATION_NOTE_DOMAIN = "annotation-note";

const AnnotationNoteSchema = z
	.object({
		label: z.string().describe("The persisted type of the annotated individual."),
		id: z.string().describe("The annotated individual's id."),
		exact: z.string(),
		prefix: z.string().optional(),
		suffix: z.string().optional(),
		text: z.string().describe("The note's body."),
		at: z
			.string()
			.optional()
			.describe(
				"The start (ISO) of the period the note describes, such as a milestone's week. It is stored as startedAtTime, so time-placed views place the note there. The record's own generatedAtTime holds the write time.",
			),
		until: z
			.string()
			.optional()
			.describe("The end (ISO) of the period the note describes, stored as endedAtTime. Time-placed views read a note with `at` and `until` as an interval."),
		links: z.array(QuoteAnchorSchema).optional().describe("Further passages in the same document that this note cross-references. Each renders as a followable link."),
	})
	.describe(
		"The full shape of one W3C Web Annotation: the anchored passage, the note, its time and any cross-referenced passages. Each prose annotate form binds a part of this shape, and this composite carries all of it.",
	);
export type TAnnotationNote = z.infer<typeof AnnotationNoteSchema>;
export const annotationNoteDomainDefinition: TDomainDefinition = {
	selectors: [ANNOTATION_NOTE_DOMAIN],
	schema: fromJsonText(AnnotationNoteSchema),
	description: "A complete annotation act as one value: passage, note, time, and cross-reference links.",
};

// ============================================================================
// Discourse write helpers, comment and annotation acts over a quad store
// ============================================================================

/** The store surface the discourse write helpers call: node upsert and delete, single-property set, quad add,
 *  query and remove, and the navigable createEdge and referenceEdge of a property-graph store. Every member is an
 *  `IQuadStore` member, so every consumer store implements it. Naming only the members these helpers call keeps them
 *  store-agnostic. */
export type TDiscourseStore = {
	upsertIndividual(label: string, data: unknown): Promise<string>;
	deleteIndividual(label: string, id: string): Promise<void>;
	set(subject: string, predicate: string, object: unknown, namedGraph: string): Promise<void>;
	query(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): Promise<Array<{ subject: string; predicate: string; object: unknown }>>;
	add(quad: { subject: string; predicate: string; object: unknown; namedGraph: string; objectType?: string }): Promise<void>;
	remove(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): Promise<void>;
	createEdge?(fromLabel: string, fromId: string, edgeLabel: string, toLabel: string, toId: string): Promise<void>;
	/** Writes an edge to a target that may not exist yet, such as a document not yet read or a record not yet written. A
	 *  store with strict edges holds an id-only placeholder until the target is written. A store that models edges as quads
	 *  doesn't need the distinction. */
	referenceEdge?(fromLabel: string, fromId: string, edgeLabel: string, toLabel: string, toId: string): Promise<void>;
};

/** The maximum length of a Comment's display name. The name is the note text on one line, truncated, so a graph view titles the Comment by its text and not its id. */
const COMMENT_NAME_MAX = 60;
export function commentName(text: string): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > COMMENT_NAME_MAX ? `${oneLine.slice(0, COMMENT_NAME_MAX - 1)}…` : oneLine;
}

/** Writes a navigable edge. A property-graph store creates an edge that traversal follows, and a quad store writes it as a quad. */
export async function writeEdge(store: TDiscourseStore, fromLabel: string, fromId: string, rel: string, toLabel: string, toId: string): Promise<void> {
	if (store.createEdge) await store.createEdge(fromLabel, fromId, rel, toLabel, toId);
	// objectType records the target's type, so the quad reads back as an edge rather than a literal property.
	else await store.add({ subject: fromId, predicate: rel, object: toId, namedGraph: fromLabel, objectType: toLabel });
}

/** Writes an edge to a target that may not exist yet. A text that refers to an unread document states one, and so does
 *  an observation of a request that names an endpoint whose record isn't written yet. A store that doesn't keep
 *  placeholders receives the ordinary edge write, because an edge to an absent target is a quad there. */
export async function writeReferenceEdge(store: TDiscourseStore, fromLabel: string, fromId: string, rel: string, toLabel: string, toId: string): Promise<void> {
	if (store.referenceEdge) await store.referenceEdge(fromLabel, fromId, rel, toLabel, toId);
	else await writeEdge(store, fromLabel, fromId, rel, toLabel, toId);
}

/** Returns the selector record that locates a part and the text the part reads as. A quoted passage gets a
 *  TextQuoteSelector and a media fragment gets a FragmentSelector. */
const selectorOf = (part: TPart): { label: string; fields: Record<string, string>; reads: string } =>
	isFragment(part)
		? { label: FRAGMENT_SELECTOR_LABEL, fields: { conformsTo: part.conformsTo, value: part.value }, reads: part.value }
		: {
				label: TEXT_QUOTE_SELECTOR_LABEL,
				fields: { exact: part.exact, ...(part.prefix !== undefined ? { prefix: part.prefix } : {}), ...(part.suffix !== undefined ? { suffix: part.suffix } : {}) },
				reads: part.exact,
			};

/** Anchors a part inside (sourceLabel, sourceId). It writes the selector that locates the part and a SpecificResource
 *  that names the source and the selector. A quote's optional prefix and suffix let a short or repeated quote resolve to
 *  one occurrence. Returns the ids it wrote and the selector's type. A Comment's oa:hasTarget (anchor) or oa:hasBody
 *  linksTo (cross-reference) points at the SpecificResource. The selector id lets a caller that owns the anchor retract
 *  the pair. */
export async function anchorPart(
	store: TDiscourseStore,
	sourceLabel: string,
	sourceId: string,
	part: TPart,
	now: string,
	/** `sourceMayBeAbsent`: a text can quote a document that hasn't been read. Annotating a record already in the store
	 *  doesn't need it. `label`: the name a reader gave this part where it was referenced, so it reads as more than its
	 *  selector. */
	opts?: { sourceMayBeAbsent?: boolean; label?: string },
): Promise<{ specificResourceId: string; selectorId: string; selectorLabel: string }> {
	const selector = selectorOf(part);
	const selectorId = crypto.randomUUID();
	await store.upsertIndividual(selector.label, { id: selectorId, ...selector.fields, generatedAtTime: now });
	const specificResourceId = crypto.randomUUID();
	// An anchor reads as the part it represents. Its id is a generated string. Resolving the title through its selector
	// is a hop through a second proxy, and that hop ends at the id. A node without a label reads as that string.
	await store.upsertIndividual(SPECIFIC_RESOURCE_LABEL, { id: specificResourceId, generatedAtTime: now, label: opts?.label ?? selector.reads });
	const writeSourceEdge = opts?.sourceMayBeAbsent ? writeReferenceEdge : writeEdge;
	await writeSourceEdge(store, SPECIFIC_RESOURCE_LABEL, specificResourceId, LinkRelations.HAS_SOURCE.rel, sourceLabel, sourceId);
	await writeEdge(store, SPECIFIC_RESOURCE_LABEL, specificResourceId, LinkRelations.HAS_SELECTOR.rel, selector.label, selectorId);
	return { specificResourceId, selectorId, selectorLabel: selector.label };
}

/** Rels that ground a Comment in its subject: an oa:hasTarget subject or an attachment. Reply-family rels also ground
 *  it. They are inReplyTo and its sub-properties, such as narrate, and isReplyEdge checks them. */
const GROUNDING_RELS = new Set<string>([LinkRelations.TARGET.rel, LinkRelations.ATTACHMENT.rel]);

/** Throws unless a Comment references its subject through an oa:hasTarget subject, an attachment, or the comment it
 *  replies to in a thread. The comment's edges are read from the Comment type alone, so the read doesn't look for it in
 *  every type. A conversation root without a subject is a general question and its own origin, so callers
 *  skip the check there. */
export async function assertCommentGrounded(store: TDiscourseStore, commentId: string): Promise<void> {
	const quads = await store.query({ subject: commentId, namedGraph: COMMENT_LABEL });
	const grounded = quads.some((q) => GROUNDING_RELS.has(q.predicate) || isReplyEdge(q.predicate));
	if (!grounded) throw new Error(`Comment "${commentId}" is not grounded: every comment must reference its subject through hasTarget, attachment or a reply edge.`);
}

/** Walks reply-family edges upward from an individual to its conversation root, so a comment groups under the same root
 *  as its subject. Stops at the first individual without a reply parent, so a top-level subject is its own root. */
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

// ============================================================================
// Typed-link derivation: turning a text's links into facts
// ============================================================================

/** One record per statement a reading made: an edge it stated or an individual it wrote. A later reading of the same
 *  source reads these records back to undo the reading, and a lookup reads them to find the reading that stated an edge. */
export const StatedRecordSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("edge"), s: z.string(), sLabel: z.string(), rel: z.string(), o: z.string(), oLabel: z.string() }),
	z.object({ kind: z.literal("individual"), label: z.string(), id: z.string() }),
]);
export type TStatedRecord = z.infer<typeof StatedRecordSchema>;

// ============================================================================
// Property definitions, runtime projection of LinkRelations
// ============================================================================

/**
 * The runtime shape of a rel definition. `LinkRelations` is the declaration and this is its serialised projection. The
 * server sends it to the SPA, so renderers read label, icon, presentation and RDFS ancestry without bundling the const.
 * The graph doesn't store a copy that could diverge.
 */
type TPropertyDefinition = {
	id: string;
	iri: string;
	range: TRelRange;
	label?: string;
	icon?: string;
	/** One or more parent rels (rdfs:subPropertyOf). A rel may declare several upper concepts as parents. */
	subPropertyOf?: string | string[];
	presentation?: TRelPresentation;
	/** The actor-edge ordering weight, where the highest takes precedence. See TEdgeDef.rolePriority. */
	rolePriority?: number;
};

/**
 * Projects the `LinkRelations` const to a flat list of property definitions. Every call returns the same data. The
 * server's site-metadata builder reads it and sends it to the SPA's rels cache. The TS const is the declaration, and
 * this is its only runtime form.
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
