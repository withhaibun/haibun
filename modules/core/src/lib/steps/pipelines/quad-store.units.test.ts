/**
 * The in-memory store writes a unit in one operation: the records a node embeds under the edges its type declares `owns`, its
 * record and its edges, each checked before any is held, so a unit the store refuses isn't held in part. Each verb states its
 * intent: `create` refuses a record the store holds, `update` refuses a record that changed since its read, and `merge` applies
 * fields. It removes a record with what it owns, or one of its edges.
 */
import { describe, expect, it } from "vitest";
import { Access, BODY_LABEL, COMMENT_LABEL, LinkRelations, PRINCIPAL_LABEL, commentDomainDefinition } from "../../domains/resources.js";
import { bodyDomainDefinition } from "../../domains/resource-domains.js";
import { recordOf } from "../../records/pipelines/record-reads.js";
import { ChangedSinceRead, referenceTo } from "../../records/domains/unit.js";
import { newStoreChain, QuadStore } from "./quad-store.js";
import { declaredTypes, storeDeclaring, storeOfDomains, TEST_LEVELS } from "../../test/declared-types.js";
import type { IQuadStore } from "../ports.js";

const NOTE = "Note";
const edge = (ranges: string[], kind: { owns?: true; functional?: true; reference?: true } = {}) => ({
	ranges,
	owns: kind.owns === true,
	reference: kind.reference === true,
	functional: kind.functional === true,
});
/** Notes, each of which may reach other notes through `about`, one note through `in`, one note the store may not hold through
 *  `after`, and owns the notes it holds through `holds`. */
const NOTES = {
	[NOTE]: {
		edges: { about: edge([NOTE]), in: edge([NOTE], { functional: true }), after: edge([NOTE], { functional: true, reference: true }), holds: edge([NOTE], { owns: true }) },
	},
};
const noteStore = (): QuadStore => storeDeclaring(NOTES);
/** Writes the notes `ids` names, which a test's edges reach. */
const notesHeld = async (store: QuadStore, ...ids: string[]) => {
	for (const id of ids) await store.merge({ "@type": NOTE, id });
};
const edgesOf = async (store: QuadStore, label: string, id: string, rel: string) =>
	(await store.query({ subject: id, predicate: rel, namedGraph: label })).map(({ object, objectType }) => [object, objectType]);

describe("a unit the in-memory store writes", () => {
	it("holds the records its node embeds under an owns edge, its record and its edges, and returns the id of its record", async () => {
		const store = storeOfDomains([commentDomainDefinition, bodyDomainDefinition], TEST_LEVELS);
		const body = { id: "body-c1", content: "the note", mediaType: "text/markdown", accessLevel: Access.private };
		expect(await store.create({ "@type": COMMENT_LABEL, id: "c1", author: "did:example:a", accessLevel: Access.private, [LinkRelations.HAS_BODY.rel]: body })).toBe("c1");
		expect(await recordOf(store, BODY_LABEL, "body-c1"), "the Body it owns").toMatchObject({ content: "the note" });
		expect(await edgesOf(store, COMMENT_LABEL, "c1", LinkRelations.HAS_BODY.rel)).toEqual([["body-c1", BODY_LABEL]]);
	});

	it("writes the edges of a node that names a record the store doesn't hold by its id alone, without the provenance of a record", async () => {
		const store = storeOfDomains([commentDomainDefinition, bodyDomainDefinition], TEST_LEVELS);
		const author = { [LinkRelations.ATTRIBUTED_TO.rel]: referenceTo(PRINCIPAL_LABEL, "did:example:a") };
		expect(await store.merge({ "@type": COMMENT_LABEL, "@id": "c0", ...author })).toBe("c0");
		expect(await edgesOf(store, COMMENT_LABEL, "c0", LinkRelations.ATTRIBUTED_TO.rel)).toEqual([["did:example:a", PRINCIPAL_LABEL]]);
		expect(await edgesOf(store, COMMENT_LABEL, "c0", LinkRelations.GENERATED_AT_TIME.rel), "a reference doesn't state a time of writing").toEqual([]);
		await store.merge({ "@type": COMMENT_LABEL, id: "c0", author: "did:example:a", accessLevel: Access.private });
		expect(await recordOf(store, COMMENT_LABEL, "c0"), "a later write of the record holds its fields beside the edge").toMatchObject({ author: "did:example:a" });
		expect(await edgesOf(store, COMMENT_LABEL, "c0", LinkRelations.ATTRIBUTED_TO.rel)).toEqual([["did:example:a", PRINCIPAL_LABEL]]);
	});

	it("refuses a unit whose owned record its type's schema refuses, and doesn't hold the record that owns it", async () => {
		const store = storeOfDomains([commentDomainDefinition, bodyDomainDefinition]);
		await expect(store.create({ "@type": COMMENT_LABEL, id: "c1", author: "did:example:a", [LinkRelations.HAS_BODY.rel]: { id: "body-c1", content: 7 } })).rejects.toThrow();
		expect(await store.query({ subject: "c1" }), "the Comment").toEqual([]);
	});

	it("refuses a record embedded under an edge its owner's type doesn't declare owns, and doesn't hold either record", async () => {
		const store = noteStore();
		await expect(store.create({ "@type": NOTE, id: "n1", about: { id: "n2", title: "embedded" } })).rejects.toThrow(
			"Note embeds a Note record under its edge about, which its type doesn't declare owns",
		);
		expect(await store.query({ namedGraph: NOTE })).toEqual([]);
	});

	it("merges a node's fields over the fields the store holds, a null removing one, and keeps its edges", async () => {
		const store = noteStore();
		await store.merge({ "@type": NOTE, id: "n2" });
		await store.merge({ "@type": NOTE, id: "n1", title: "first", tag: "kept", about: referenceTo(NOTE, "n2") });
		await store.merge({ "@type": NOTE, id: "n1", title: "second" });
		expect(await recordOf(store, NOTE, "n1"), "merged").toMatchObject({ title: "second", tag: "kept" });
		await store.merge({ "@type": NOTE, "@id": "n1", tag: null });
		expect((await recordOf(store, NOTE, "n1"))?.tag).toBeUndefined();
		expect(await edgesOf(store, NOTE, "n1", "about")).toEqual([["n2", NOTE]]);
	});

	it("refuses an edge to a record the store doesn't hold, and keeps the record whose edge reaches one it holds", async () => {
		const store = noteStore();
		await expect(store.merge({ "@type": NOTE, id: "n1", about: referenceTo(NOTE, "absent") })).rejects.toThrow(
			`${NOTE} "n1" holds an edge about to ${NOTE}:absent, which the store doesn't hold`,
		);
		expect(await store.query({ namedGraph: NOTE }), "a refused unit isn't held in part").toEqual([]);
		await notesHeld(store, "held");
		await store.merge({ "@type": NOTE, id: "n1", about: referenceTo(NOTE, "held") });
		expect(await edgesOf(store, NOTE, "n1", "about")).toEqual([["held", NOTE]]);
	});

	it("refuses a functional edge to a record the store doesn't hold, and replaces a functional reference's target it doesn't hold", async () => {
		const store = noteStore();
		await expect(store.merge({ "@type": NOTE, id: "n1", in: referenceTo(NOTE, "absent") }), "a held target, which the relation's one edge reaches").rejects.toThrow(
			`${NOTE} "n1" holds an edge in to ${NOTE}:absent, which the store doesn't hold`,
		);
		await store.merge({ "@type": NOTE, id: "n1", after: referenceTo(NOTE, "first") });
		await store.merge({ "@type": NOTE, "@id": "n1", after: referenceTo(NOTE, "second") });
		expect(await edgesOf(store, NOTE, "n1", "after"), "a reference, which replaces the relation's other edge").toEqual([["second", NOTE]]);
	});

	it("adds an edge beside the record's edges of a relation, and replaces its edge of a relation its type declares functional", async () => {
		const store = noteStore();
		await notesHeld(store, "a", "b");
		await store.merge({ "@type": NOTE, id: "n1", about: referenceTo(NOTE, "a"), in: referenceTo(NOTE, "a") });
		await store.merge({ "@type": NOTE, "@id": "n1", about: referenceTo(NOTE, "b"), in: referenceTo(NOTE, "b") });
		expect(await edgesOf(store, NOTE, "n1", "about"), "an edge beside one").toEqual([
			["a", NOTE],
			["b", NOTE],
		]);
		expect(await edgesOf(store, NOTE, "n1", "in"), "the one target").toEqual([["b", NOTE]]);
	});

	it("lets one of two creates of one record at once write it, and refuses the other", async () => {
		const store = noteStore();
		const outcomes = await Promise.allSettled(["first", "second"].map((title) => store.create({ "@type": NOTE, id: "n1", title })));
		expect(outcomes.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
		expect(outcomes.find((outcome) => outcome.status === "rejected")?.reason).toBeInstanceOf(ChangedSinceRead);
	});

	it("refuses an update from a version the record changed since, and writes one from the version it holds", async () => {
		const store = noteStore();
		await store.create({ "@type": NOTE, id: "n1", title: "first" });
		const read = await store.versionOf({ label: NOTE, id: "n1" });
		await store.merge({ "@type": NOTE, id: "n1", title: "changed by another writer" });
		await expect(store.update({ "@type": NOTE, id: "n1", title: "stale" }, read)).rejects.toThrow(ChangedSinceRead);
		expect((await recordOf(store, NOTE, "n1"))?.title).toBe("changed by another writer");
		await store.update({ "@type": NOTE, id: "n1", title: "current" }, await store.versionOf({ label: NOTE, id: "n1" }));
		expect((await recordOf(store, NOTE, "n1"))?.title).toBe("current");
	});

	it("writes a unit whose parts one backing store holds through that store, and refuses a unit whose parts different stores hold", async () => {
		const chain = newStoreChain();
		const store = new QuadStore(chain, undefined, () => declaredTypes(NOTES));
		const backing: IQuadStore = new QuadStore(newStoreChain(), undefined, () => declaredTypes(NOTES));
		await store.registerStore(backing, [NOTE]);
		await store.create({ "@type": NOTE, id: "n1", holds: { id: "n2", title: "part" } });
		expect(await backing.get("n2", "title", NOTE), "the part is in the backing store").toBe("part");
		const OTHER = "Other";
		const spanning = new QuadStore(chain, undefined, () => declaredTypes({ ...NOTES, [OTHER]: { edges: { holds: edge([NOTE], { owns: true }) } } }));
		await expect(spanning.create({ "@type": OTHER, id: "o1", holds: { id: "n3", title: "part" } })).rejects.toThrow(
			'Other "o1" owns records that different stores hold: Note (a backing store), Other (this store)',
		);
		expect(await backing.query({ subject: "n3" })).toEqual([]);
	});
});

describe("the store's write port", () => {
	it("doesn't type-check a write that doesn't state its verb", () => {
		const store: IQuadStore = noteStore();
		// @ts-expect-error a store writes through create, update or merge, so each write states its intent
		expect(store.write).toBeUndefined();
	});
});

describe("a removal from the in-memory store", () => {
	it("removes one edge and keeps the record, and removes the record with each record it owns", async () => {
		const store = noteStore();
		await notesHeld(store, "a", "b");
		await store.create({
			"@type": NOTE,
			id: "n1",
			title: "first",
			about: [referenceTo(NOTE, "a"), referenceTo(NOTE, "b")],
			holds: { id: "n2", title: "owned", holds: { id: "n3", title: "owned in turn" } },
		});
		await store.remove({ label: NOTE, id: "n1", edge: { rel: "about", to: { label: NOTE, id: "a" } } });
		expect(await edgesOf(store, NOTE, "n1", "about")).toEqual([["b", NOTE]]);
		await store.remove({ label: NOTE, id: "n1" });
		expect(
			(await store.query({ namedGraph: NOTE })).map(({ subject }) => subject),
			"the record and what it owns, transitively",
		).toEqual(["a", "b"]);
	});
});
