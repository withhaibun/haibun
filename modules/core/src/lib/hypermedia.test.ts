import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildConcernCatalog, composeDisplayLabel, MAX_DISPLAY_LABEL_LEN, queryableFields } from "./hypermedia.js";
import type { THypermediaTopology } from "./resources.js";
import { LinkRelations, specificResourceDomainDefinition, textQuoteSelectorDomainDefinition, commentDomainDefinition, principalDomainDefinition } from "./resources.js";

const props = (o: Record<string, unknown>) => (f: string) => o[f];

describe("composeDisplayLabel priority: headline → body → weak → id", () => {
	it("uses NAME when present, over a body and a seqPath", () => {
		const rels = { subject: LinkRelations.NAME.rel, seqPath: LinkRelations.SEQ_PATH.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ subject: "RE: Meeting", seqPath: "0.1" }), bodyContents: ["the body"], id: "e1" })).toBe("RE: Meeting");
	});

	it("uses rdfs:label over the entity's NAME: an explicit display label wins", () => {
		const rels = { label: LinkRelations.LABEL.rel, name: LinkRelations.NAME.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ label: "Coastal Fisheries Authority", name: "should-not-win" }), bodyContents: [], id: "did:web:x" })).toBe(
			"Coastal Fisheries Authority",
		);
	});

	it("titles a name-less node (e.g. a Principal/DID) by its rdfs:label instead of falling back to the id", () => {
		const rels = { label: LinkRelations.LABEL.rel, controller: LinkRelations.CONTROLLER.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ label: "Importer Co.", controller: "did:web:x" }), bodyContents: [], id: "did:web:x" })).toBe("Importer Co.");
	});

	it("uses an inline CONTENT field when there is no name", () => {
		const rels = { text: LinkRelations.CONTENT.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ text: "inline note" }), bodyContents: [], id: "n1" })).toBe("inline note");
	});

	it("uses the linked-body preview over a seqPath (the Comment regression)", () => {
		const rels = { seqPath: LinkRelations.SEQ_PATH.rel, author: LinkRelations.ATTRIBUTED_TO.rel };
		const label = composeDisplayLabel({ rels, getProperty: props({ seqPath: "0.-1.26", author: "did:x" }), bodyContents: ["Lawrence vouches for this"], id: "cmt-say-0.-1.26" });
		expect(label).toBe("Lawrence vouches for this");
		expect(label).not.toContain("seqPath");
	});

	it("falls to a weak provenance pointer only when there is no headline or body", () => {
		const rels = { seqPath: LinkRelations.SEQ_PATH.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ seqPath: "0.1" }), bodyContents: [], id: "x" })).toBe("seqPath: 0.1");
	});

	it("falls to the subject id when nothing resolves", () => {
		expect(composeDisplayLabel({ rels: {}, getProperty: () => undefined, bodyContents: [], id: "n1" })).toBe("n1");
		expect(composeDisplayLabel({ rels: undefined, getProperty: () => undefined, id: "n2" })).toBe("n2");
	});

	it("titles a type by the labeling property its own vocabulary declares, when it has no shared headline", () => {
		// oa:exact is literal-ranged, so the selector's title is that property's value, read off the node itself.
		const rels = { exact: LinkRelations.EXACT.rel, id: LinkRelations.IDENTIFIER.rel };
		const label = composeDisplayLabel({
			rels,
			getProperty: props({ exact: "a passage inside the document", id: "sel-1" }),
			displayLabel: { rel: LinkRelations.EXACT.rel },
			id: "sel-1",
		});
		expect(label).toBe("a passage inside the document");
	});

	it("titles a proxy THROUGH an iri-ranged labeling property, by the label of what it stands for", () => {
		// oa:hasSelector is iri-ranged: the SpecificResource has no text of its own, so its title is its selector's.
		const rels = { id: LinkRelations.IDENTIFIER.rel };
		const args = { rels, getProperty: props({ id: "sr-1" }), id: "sr-1" };
		expect(composeDisplayLabel({ ...args, displayLabel: { rel: LinkRelations.HAS_SELECTOR.rel, linkedLabel: "a passage inside the document" } })).toBe(
			"a passage inside the document",
		);
		// Nothing at the far end (an unresolved or access-filtered target) falls through to the id, never to a blank title.
		expect(composeDisplayLabel({ ...args, displayLabel: { rel: LinkRelations.HAS_SELECTOR.rel } })).toBe("sr-1");
		expect(composeDisplayLabel({ ...args, displayLabel: { rel: LinkRelations.HAS_SELECTOR.rel, linkedLabel: "  " } })).toBe("sr-1");
	});

	it("an explicit rdfs:label outranks the type's declared labeling property: the reader's title wins", () => {
		const rels = { exact: LinkRelations.EXACT.rel, label: LinkRelations.LABEL.rel };
		const label = composeDisplayLabel({ rels, getProperty: props({ exact: "the quote", label: "What this marks" }), displayLabel: { rel: LinkRelations.EXACT.rel }, id: "sel-1" });
		expect(label).toBe("What this marks");
	});

	it("a declared labeling property outranks the shared headline: the type's own vocabulary is more specific", () => {
		const rels = { exact: LinkRelations.EXACT.rel, name: LinkRelations.NAME.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ exact: "the quote", name: "generic name" }), displayLabel: { rel: LinkRelations.EXACT.rel }, id: "x" })).toBe(
			"the quote",
		);
	});

	it("the real core types declare a labeling property exactly where the shared headline cannot title them", () => {
		const topologyOf = (d: { topology: unknown }) => d.topology as THypermediaTopology;
		expect(topologyOf(textQuoteSelectorDomainDefinition).displayLabel).toBe(LinkRelations.EXACT.rel);
		expect(topologyOf(specificResourceDomainDefinition).displayLabel).toBe(LinkRelations.HAS_SELECTOR.rel);
		// A Comment says what it is by its own note text (as:name / content): no vocabulary-specific title needed.
		expect(topologyOf(commentDomainDefinition).displayLabel).toBeUndefined();
		expect(topologyOf(principalDomainDefinition).displayLabel).toBeUndefined();
	});

	it("rejects a declared labeling property the type does not carry: it would silently title nothing", () => {
		const topology: THypermediaTopology = {
			persistedAs: "Thing",
			id: "id",
			properties: { id: LinkRelations.IDENTIFIER.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
			displayLabel: LinkRelations.EXACT.rel,
		};
		const domains = { thing: { selectors: ["thing"], description: "d", schema: z.object({ id: z.string(), generatedAtTime: z.string() }), topology } };
		expect(() => buildConcernCatalog(domains)).toThrow(/displayLabel .* no property or edge with that rel/);
	});

	it("picks the shortest non-empty body: the concise summary, not a blob", () => {
		expect(composeDisplayLabel({ rels: undefined, getProperty: () => undefined, bodyContents: ["x".repeat(300), "short", ""], id: "a" })).toBe("short");
	});

	it("clamps to MAX_DISPLAY_LABEL_LEN with an ellipsis", () => {
		const label = composeDisplayLabel({ rels: undefined, getProperty: () => undefined, bodyContents: ["y".repeat(200)], id: "a" });
		expect(label.length).toBe(MAX_DISPLAY_LABEL_LEN);
		expect(label.endsWith("…")).toBe(true);
	});
});

describe("queryableFields: the one declaration-side derivation of a type's queryable surface", () => {
	const schema = z.object({
		messageId: z.string(),
		subject: z.string(),
		folder: z.string(),
		size: z.number(),
		flagged: z.boolean().optional(),
		generatedAtTime: z.coerce.date().default(() => new Date()),
		attachments: z.array(z.object({ name: z.string() })),
	});
	const topology: THypermediaTopology = {
		persistedAs: "Email",
		id: "messageId",
		properties: { subject: LinkRelations.NAME.rel, folder: LinkRelations.CONTEXT.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
		sortColumns: { receivedAt: "TIMESTAMPTZ" },
	};

	it("offers declared sortColumns, CONTEXT facets, the record-time field, and bounded primitives, never plain strings or the identifier", () => {
		expect(queryableFields({ schema, topology })).toEqual(["flagged", "folder", "generatedAtTime", "receivedAt", "size"]);
	});

	it("resolves a content-object property def to its rel: a body field never becomes queryable", () => {
		const withBody: THypermediaTopology = { ...topology, properties: { ...topology.properties, body: { rel: "content", mediaType: "text/html" } } };
		expect(queryableFields({ schema, topology: withBody })).not.toContain("body");
	});

	it("derives from a declaration with no schema shape (a `set of {domain}` prose declaration) via its sortColumns", () => {
		const proseTopology: THypermediaTopology = { persistedAs: "Recipe", id: "name", properties: {}, sortColumns: { servings: "DOUBLE PRECISION" } };
		expect(queryableFields({ schema: undefined, topology: proseTopology })).toEqual(["servings"]);
	});
});

describe("validTimeField: the catalog names the field a type's individuals place in time by", () => {
	it("is the declared defaultSort (the object's own time) when present, else generatedAtTime (its indexed time)", () => {
		const schema = z.object({ id: z.string(), receivedAt: z.coerce.date(), generatedAtTime: z.coerce.date().default(() => new Date()) });
		const make = (persistedAs: string, defaultSort?: string) =>
			({
				selectors: [persistedAs.toLowerCase()],
				schema,
				coerce: (v: unknown) => v,
				description: persistedAs,
				topology: {
					persistedAs,
					id: "id",
					properties: { id: LinkRelations.IDENTIFIER.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
					...(defaultSort ? { defaultSort } : {}),
				},
			}) as unknown as Parameters<typeof buildConcernCatalog>[0][string];
		const cat = buildConcernCatalog({ message: make("Message", "receivedAt"), note: make("Note") });
		expect(cat.persisted.Message.validTimeField).toBe("receivedAt");
		expect(cat.persisted.Note.validTimeField).toBe(LinkRelations.GENERATED_AT_TIME.rel);
	});
});

/**
 * A type's claim about which standard it belongs to is a declaration, not prose: it must resolve. An unbound prefix
 * still serves, the reader's JSON-LD then resolves the term to nothing, so it fails at build, where the rel checks do.
 */
describe("buildConcernCatalog vocabulary binding", () => {
	const domain = (topology: Partial<THypermediaTopology>) => ({
		thing: {
			selectors: ["thing"],
			description: "d",
			schema: z.object({ id: z.string(), generatedAtTime: z.string() }),
			topology: {
				persistedAs: "Thing",
				id: "id",
				properties: { id: LinkRelations.IDENTIFIER.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
				...topology,
			} as THypermediaTopology,
		},
	});

	it("rejects a class named in a vocabulary the type never bound", () => {
		expect(() => buildConcernCatalog(domain({ type: "vcard:Individual" }))).toThrow(/"vcard:" vocabulary is not bound/);
	});

	it("accepts it once the type declares what the prefix binds to", () => {
		expect(() => buildConcernCatalog(domain({ type: "vcard:Individual", namespaces: { vcard: "http://www.w3.org/2006/vcard/ns#" } }))).not.toThrow();
	});

	it("accepts a standard core binds for every domain, undeclared", () => {
		expect(() => buildConcernCatalog(domain({ type: "oa:SpecificResource" }))).not.toThrow();
		expect(() => buildConcernCatalog(domain({ subClassOf: "prov:Agent" }))).not.toThrow();
	});

	it("holds a superclass, a property's iri, and an edge's iri to the same rule", () => {
		expect(() => buildConcernCatalog(domain({ subClassOf: "cred:Thing" }))).toThrow(/"cred:" vocabulary is not bound/);
		expect(() =>
			buildConcernCatalog(
				domain({ properties: { id: LinkRelations.IDENTIFIER.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel, x: { rel: LinkRelations.TAG.rel, iri: "vcstatus:x" } } }),
			),
		).toThrow(/"vcstatus:" vocabulary is not bound/);
		expect(() => buildConcernCatalog(domain({ edges: { e: { rel: LinkRelations.HAS_BODY.rel, range: "Thing", iri: "zzz:e" } } }))).toThrow(/"zzz:" vocabulary is not bound/);
	});

	it("leaves an absolute IRI and a bare local name alone: neither names a vocabulary to bind", () => {
		expect(() => buildConcernCatalog(domain({ type: "https://www.w3.org/ns/did#DIDDocument" }))).not.toThrow();
		expect(() => buildConcernCatalog(domain({ subClassOf: "Thing" }))).not.toThrow();
	});
});
