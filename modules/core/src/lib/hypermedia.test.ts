import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildConcernCatalog, composeDisplayLabel, MAX_DISPLAY_LABEL_LEN, queryableFields } from "./hypermedia.js";
import type { THypermediaTopology } from "./resources.js";
import { LinkRelations } from "./resources.js";

const props = (o: Record<string, unknown>) => (f: string) => o[f];

describe("composeDisplayLabel priority: headline → body → weak → id", () => {
	it("uses NAME when present, over a body and a seqPath", () => {
		const rels = { subject: LinkRelations.NAME.rel, seqPath: LinkRelations.SEQ_PATH.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ subject: "RE: Meeting", seqPath: "0.1" }), bodyContents: ["the body"], id: "e1" })).toBe("RE: Meeting");
	});

	it("uses rdfs:label over the entity's NAME — an explicit display label wins", () => {
		const rels = { label: LinkRelations.LABEL.rel, name: LinkRelations.NAME.rel };
		expect(composeDisplayLabel({ rels, getProperty: props({ label: "Coastal Fisheries Authority", name: "should-not-win" }), bodyContents: [], id: "did:web:x" })).toBe("Coastal Fisheries Authority");
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

	it("picks the shortest non-empty body — the concise summary, not a blob", () => {
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

	it("offers declared sortColumns, CONTEXT facets, the record-time field, and bounded primitives — never plain strings or the identifier", () => {
		expect(queryableFields({ schema, topology })).toEqual(["flagged", "folder", "generatedAtTime", "receivedAt", "size"]);
	});

	it("resolves a content-object property def to its rel — a body field never becomes queryable", () => {
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
