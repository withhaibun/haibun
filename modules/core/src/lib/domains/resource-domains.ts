/**
 * The domain definitions of the resources a graph stores, which a stepper registers in `getConcerns().domains`.
 *
 * resources.ts declares their schemas, labels and vocabulary, which both server and page read. A page reads the domains
 * a server registered from the served concern catalog and doesn't import these definitions, so they are kept in a
 * module of their own that page bundles don't include.
 */
import { z } from "zod";
import { PROV_ACTIVITY, PROV_AGENT } from "./vocabularies.js";
import { fromJsonText } from "./json-text.js";
import {
	Access,
	ANNOTATION_NOTE_DOMAIN,
	BODY_LABEL,
	BodySchema,
	ENDPOINT_LABEL,
	FRAGMENT_SELECTOR_LABEL,
	FragmentSelectorSchema,
	LinkRelations,
	PersistedVertexSchema,
	PRINCIPAL_DOMAIN,
	PRINCIPAL_LABEL,
	PrincipalSchema,
	QuoteAnchorSchema,
	READING_LABEL,
	ReadingSchema,
	RESOURCE_LABEL,
	SCENE_LABEL,
	SPECIFIC_RESOURCE_LABEL,
	SpecificResourceSchema,
	TEXT_QUOTE_SELECTOR_LABEL,
	TextQuoteSelectorSchema,
	type TDomainDefinition,
} from "./resources.js";

const BODY_DOMAIN = "body";
const READING_DOMAIN = "reading";

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

/**
 * A TextQuoteSelector locates a segment of a source document by quoting it (oa:exact). The text immediately before
 * (oa:prefix) and after (oa:suffix) optionally disambiguates it. The anchor depends on content, so it remains valid
 * after re-import and re-rendering of the source, where byte offsets wouldn't.
 */
const TEXT_QUOTE_SELECTOR_DOMAIN = "text-quote-selector";

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

const SPECIFIC_RESOURCE_DOMAIN = "specific-resource";

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
			hasSource: { rel: LinkRelations.HAS_SOURCE.rel, range: RESOURCE_LABEL, reference: true },
			hasSelector: { rel: LinkRelations.HAS_SELECTOR.rel, range: [TEXT_QUOTE_SELECTOR_LABEL, FRAGMENT_SELECTOR_LABEL], owns: true },
			wasGeneratedBy: GENERATED_BY_READING,
		},
		// Titled through its selector where the individual doesn't carry an rdfs:label.
		displayLabel: "hasSelector",
	},
};

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
