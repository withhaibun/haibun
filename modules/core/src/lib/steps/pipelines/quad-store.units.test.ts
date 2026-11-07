/**
 * The in-memory store writes a unit in one operation: the units it owns, its record whole, merged or by its fields, and its
 * edges, each checked before any is held, so a unit the store refuses isn't held in part. It removes a record, one of its
 * fields or one of its edges.
 */
import { describe, expect, it } from "vitest";
import { Access, BODY_LABEL, COMMENT_LABEL, LinkRelations, commentDomainDefinition } from "../../domains/resources.js";
import { bodyDomainDefinition } from "../../domains/resource-domains.js";
import { recordOf } from "../../records/pipelines/record-reads.js";
import { EDGE_TARGET } from "../../records/domains/unit.js";
import type { QuadStore } from "./quad-store.js";
import { storeDeclaring, storeOfDomains } from "../../test/declared-types.js";

const NOTE = "Note";
/** A store that declares notes, each of which may reach another note through `about` and `in`. */
const noteStore = (): QuadStore => storeDeclaring({ [NOTE]: { relations: { about: [NOTE], in: [NOTE] } } });
const edgesOf = async (store: QuadStore, label: string, id: string, rel: string) =>
	(await store.query({ subject: id, predicate: rel, namedGraph: label })).map(({ object, objectType }) => [object, objectType]);

describe("a unit the in-memory store writes", () => {
	it("holds the units it owns, its record and its edges, and returns the id of its record", async () => {
		const store = storeOfDomains([commentDomainDefinition, bodyDomainDefinition]);
		const body = {
			label: BODY_LABEL,
			record: { id: "body-c1", content: "the note", mediaType: "text/markdown", generatedAtTime: "2026-11-07T00:00:00.000Z", accessLevel: Access.private },
		};
		const edges = [{ rel: LinkRelations.HAS_BODY.rel, label: BODY_LABEL, id: "body-c1", target: EDGE_TARGET.held }];
		expect(
			await store.write({
				label: COMMENT_LABEL,
				record: { id: "c1", author: "did:example:a", generatedAtTime: "2026-11-07T00:00:00.000Z", accessLevel: Access.private },
				owns: [body],
				edges,
			}),
		).toBe("c1");
		expect(await recordOf(store, BODY_LABEL, "body-c1"), "the Body it owns").toMatchObject({ content: "the note" });
		expect(await edgesOf(store, COMMENT_LABEL, "c1", LinkRelations.HAS_BODY.rel)).toEqual([["body-c1", BODY_LABEL]]);
	});

	it("refuses a unit whose owned record its type's schema refuses, and doesn't hold the record that owns it", async () => {
		const store = storeOfDomains([commentDomainDefinition, bodyDomainDefinition]);
		const body = { label: BODY_LABEL, record: { id: "body-c1", content: 7 } };
		await expect(store.write({ label: COMMENT_LABEL, record: { id: "c1", author: "did:example:a" }, owns: [body] })).rejects.toThrow();
		expect(await store.query({ subject: "c1" }), "the Comment").toEqual([]);
	});

	it("merges a record's stated fields over the fields it holds, and replaces them all where it doesn't merge", async () => {
		const store = noteStore();
		await store.write({ label: NOTE, record: { id: "n1", title: "first", tag: "kept" } });
		await store.write({ label: NOTE, record: { id: "n1", title: "second" }, merge: true });
		expect(await recordOf(store, NOTE, "n1"), "merged").toMatchObject({ title: "second", tag: "kept" });
		await store.write({ label: NOTE, record: { id: "n1", title: "third" } });
		expect((await recordOf(store, NOTE, "n1"))?.tag, "replaced").toBeUndefined();
	});

	it("writes a record's fields, a null removing one, and keeps its edges", async () => {
		const store = noteStore();
		await store.write({ label: NOTE, record: { id: "n1", title: "first", tag: "kept" }, edges: [{ rel: "about", label: NOTE, id: "n2", target: EDGE_TARGET.reference }] });
		await store.write({ label: NOTE, id: "n1", fields: { title: "second", tag: null } });
		expect(await recordOf(store, NOTE, "n1")).toMatchObject({ title: "second" });
		expect((await recordOf(store, NOTE, "n1"))?.tag).toBeUndefined();
		expect(await edgesOf(store, NOTE, "n1", "about")).toEqual([["n2", NOTE]]);
	});

	it("writes a record's one target of a relation in place of its edge to another, and adds an edge to a held target beside one", async () => {
		const store = noteStore();
		const edge = (id: string, target: (typeof EDGE_TARGET)[keyof typeof EDGE_TARGET]) => ({
			label: NOTE,
			id: "n1",
			referenced: true as const,
			edges: [{ rel: "in", label: NOTE, id, target }],
		});
		await store.write(edge("a", EDGE_TARGET.held));
		await store.write(edge("b", EDGE_TARGET.held));
		expect(await edgesOf(store, NOTE, "n1", "in"), "an edge beside one").toEqual([
			["a", NOTE],
			["b", NOTE],
		]);
		await store.write(edge("c", EDGE_TARGET.only));
		expect(await edgesOf(store, NOTE, "n1", "in"), "the one target").toEqual([["c", NOTE]]);
	});

	it("writes a record a name names at the level of the record that names it, and leaves a record it holds as it is", async () => {
		const store = noteStore();
		await store.write({ label: NOTE, record: { id: "namer", accessLevel: Access.public } });
		await store.write({ label: NOTE, record: { id: "named", title: "first" }, namedBy: { label: NOTE, id: "namer" } });
		await store.write({ label: NOTE, record: { id: "named", title: "second" }, namedBy: { label: NOTE, id: "namer" } });
		const [title] = await store.query({ subject: "named", predicate: "title", namedGraph: NOTE });
		expect(title).toMatchObject({ object: "first", accessLevel: Access.public });
		await expect(store.write({ label: NOTE, record: { id: "orphan" }, namedBy: { label: NOTE, id: "absent" } })).rejects.toThrow(
			"Note absent isn't recorded, so a record it names can't take its level",
		);
	});
});

describe("a removal from the in-memory store", () => {
	it("removes one edge and keeps the record, removes one field, and removes the record", async () => {
		const store = noteStore();
		const edges = ["a", "b"].map((id) => ({ rel: "in", label: NOTE, id, target: EDGE_TARGET.held }));
		await store.write({ label: NOTE, record: { id: "n1", title: "first", tag: "kept" }, edges });
		await store.remove({ label: NOTE, id: "n1", edge: { rel: "in", to: "a" } });
		expect(await edgesOf(store, NOTE, "n1", "in")).toEqual([["b", NOTE]]);
		await store.remove({ label: NOTE, id: "n1", field: "tag" });
		expect(await recordOf(store, NOTE, "n1")).toMatchObject({ title: "first" });
		expect((await recordOf(store, NOTE, "n1"))?.tag).toBeUndefined();
		await store.remove({ label: NOTE, id: "n1" });
		expect(await store.query({ subject: "n1" })).toEqual([]);
	});
});
