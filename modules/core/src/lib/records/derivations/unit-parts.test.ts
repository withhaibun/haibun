import { describe, expect, it } from "vitest";
import { z } from "zod";
import { WRITE_VERB } from "../domains/unit.js";
import { EDGE_TARGET, edgeDeclarationsOf, type TPartDeclaration } from "./edge-declarations.js";
import { changedFields, edgesAsNode, partDeclarationOf, unitParts } from "./unit-parts.js";

const MESSAGE = "Message";
const PERSON = "Person";
const BODY = "Body";
const FOLDER = "Folder";

const declarations: Record<string, TPartDeclaration> = {
	[MESSAGE]: partDeclarationOf({
		id: "id",
		schema: z.object({ id: z.string(), subject: z.string(), from: z.string().optional(), to: z.array(z.string()).optional() }),
		edges: edgeDeclarationsOf({
			from: { range: PERSON },
			to: { range: PERSON },
			hasBody: { range: BODY, owns: true },
			folder: { range: FOLDER, functional: true },
			repliesTo: { range: MESSAGE, reference: true },
		}),
	}),
	[BODY]: partDeclarationOf({ id: "id", schema: z.object({ id: z.string(), content: z.string() }), edges: {} }),
};
const declarationOf = (label: string) => declarations[label];

describe("the parts of a unit", () => {
	it("writes what a record owns before the record, with each edge's target as its type declares it", () => {
		const unit = unitParts(
			WRITE_VERB.create,
			{
				"@type": MESSAGE,
				id: "m1",
				subject: "a message",
				hasBody: { id: "b1", content: "the text" },
				folder: { "@type": FOLDER, "@id": "inbox" },
				repliesTo: { "@id": "m0" },
				from: { "@id": "alice" },
			},
			undefined,
			declarationOf,
		);
		expect(unit.version, "a create states that the store doesn't hold the record").toBeNull();
		expect(unit.parts.map(({ label, id }) => `${label} ${id}`)).toEqual([`${BODY} b1`, `${MESSAGE} m1`]);
		expect(unit.parts.at(-1)?.edges.map(({ rel, id, target }) => [rel, id, target])).toEqual([
			["hasBody", "b1", EDGE_TARGET.held],
			["folder", "inbox", EDGE_TARGET.only],
			["repliesTo", "m0", EDGE_TARGET.reference],
			["from", "alice", EDGE_TARGET.held],
		]);
	});

	it("holds a field's literals beside its edge's records under one key, as a list where the schema's field is a list", () => {
		const unit = unitParts(
			WRITE_VERB.merge,
			{ "@type": MESSAGE, id: "m2", subject: "two", from: ["Alice <alice>", { "@id": "alice" }], to: ["Bob <bob>", { "@id": "bob" }] },
			undefined,
			declarationOf,
		);
		const [part] = unit.parts;
		expect(part?.fields).toEqual({ id: "m2", subject: "two", from: "Alice <alice>", to: ["Bob <bob>"] });
		expect(part?.edges.map(({ rel, id }) => `${rel} ${id}`)).toEqual(["from alice", "to bob"]);
		expect(unit.version, "a merge doesn't depend on a read").toBeUndefined();
	});

	it("refuses several literals for a field of one value, and literals beside records where the schema doesn't hold the field", () => {
		expect(() => unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m3", from: ["a", "b", { "@id": "alice" }] }, undefined, declarationOf)).toThrow(
			"Message's edge from holds 2 literals beside its records",
		);
		expect(() => unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m3", folder: ["inbox", { "@id": "inbox" }] }, undefined, declarationOf)).toThrow(
			"its schema doesn't hold them as its field folder",
		);
	});

	it("refuses a record embedded under an edge its type doesn't declare owns, and an edge the type doesn't declare", () => {
		expect(() => unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m4", from: { "@type": PERSON, id: "alice", name: "Alice" } }, undefined, declarationOf)).toThrow(
			"which its type doesn't declare owns",
		);
		expect(() => unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m4", wroteBy: { "@id": "alice" } }, undefined, declarationOf)).toThrow(
			"Message doesn't declare the edge wroteBy",
		);
	});

	it("states the version an update read", () => {
		expect(unitParts(WRITE_VERB.update, { "@type": MESSAGE, "@id": "m5", subject: "again" }, "7", declarationOf).version).toBe("7");
	});
});

describe("a part's changed fields", () => {
	it("are the fields whose values differ from what the store holds, and a null where the store holds a value", () => {
		const [part] = unitParts(WRITE_VERB.merge, { "@type": BODY, id: "b2", content: "new", stale: null, kept: 1 }, undefined, declarationOf).parts;
		if (part === undefined) throw new Error("the unit holds its record's part");
		expect(changedFields(part, { id: "b2", content: "old", stale: "x", kept: 1 }, "id")).toEqual(["content", "stale"]);
		expect(changedFields(part, undefined, "id"), "every stated field of a record the store doesn't hold").toEqual(["content", "kept"]);
	});
});

describe("edges as a node states them", () => {
	it("are the references to each relation's targets, by relation", () => {
		expect(
			edgesAsNode([
				{ rel: "to", label: PERSON, id: "a" },
				{ rel: "to", label: PERSON, id: "b" },
				{ rel: "folder", label: FOLDER, id: "inbox" },
			]),
		).toEqual({
			to: [
				{ "@type": PERSON, "@id": "a" },
				{ "@type": PERSON, "@id": "b" },
			],
			folder: [{ "@type": FOLDER, "@id": "inbox" }],
		});
	});
});
