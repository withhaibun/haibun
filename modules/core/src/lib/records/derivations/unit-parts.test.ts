import { describe, expect, it } from "vitest";
import { z } from "zod";
import { referenceTo, WRITE_VERB } from "../domains/unit.js";
import { EDGE_TARGET, edgeDeclarationsOf, type TPartDeclaration } from "./edge-declarations.js";
import { changedFields, edgesAsNode, partDeclarationOf, unitParts } from "./unit-parts.js";
import { textDigest } from "../../domains/hypermedia.js";

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
			thread: { range: MESSAGE, reference: true, functional: true },
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
				folder: referenceTo(FOLDER, "inbox"),
				repliesTo: referenceTo(MESSAGE, "m0"),
				thread: referenceTo(MESSAGE, "t0"),
				from: referenceTo(PERSON, "alice"),
			},
			undefined,
			declarationOf,
		);
		expect(unit.version, "a create states that the store doesn't hold the record").toBeNull();
		expect(unit.parts.map(({ label, id }) => `${label} ${id}`)).toEqual([`${BODY} b1`, `${MESSAGE} m1`]);
		expect(
			unit.parts.at(-1)?.edges.map(({ rel, id, target, replaces }) => [rel, id, target, replaces]),
			"whether a target is held and whether an edge replaces the relation's other edges are declared apart",
		).toEqual([
			["hasBody", "b1", EDGE_TARGET.held, false],
			["folder", "inbox", EDGE_TARGET.held, true],
			["repliesTo", "m0", EDGE_TARGET.reference, false],
			["thread", "t0", EDGE_TARGET.reference, true],
			["from", "alice", EDGE_TARGET.held, false],
		]);
	});

	it("holds a field's literals beside its edge's records under one key, as a list where the schema's field is a list", () => {
		const unit = unitParts(
			WRITE_VERB.merge,
			{ "@type": MESSAGE, id: "m2", subject: "two", from: ["Alice <alice>", referenceTo(PERSON, "alice")], to: ["Bob <bob>", referenceTo(PERSON, "bob")] },
			undefined,
			declarationOf,
		);
		const [part] = unit.parts;
		expect(part?.fields).toEqual({ id: "m2", subject: "two", from: "Alice <alice>", to: ["Bob <bob>"] });
		expect(part?.edges.map(({ rel, id }) => `${rel} ${id}`)).toEqual(["from alice", "to bob"]);
		expect(unit.version, "a merge doesn't depend on a read").toBeUndefined();
	});

	it("doesn't write a field or an edge for an empty list under an edge, and writes an empty field where the schema's field is a list", () => {
		const [part] = unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m3", subject: "three", repliesTo: [], to: [] }, undefined, declarationOf).parts;
		expect(part?.fields).toEqual({ id: "m3", subject: "three", to: [] });
		expect(part?.edges).toEqual([]);
	});

	it("refuses several literals for a field of one value, and literals beside records where the schema doesn't hold the field", () => {
		expect(() => unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m3", from: ["a", "b", referenceTo(PERSON, "alice")] }, undefined, declarationOf)).toThrow(
			"Message's edge from holds 2 literals beside its records",
		);
		expect(() => unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m3", folder: ["inbox", referenceTo(FOLDER, "inbox")] }, undefined, declarationOf)).toThrow(
			"its schema doesn't hold them as its field folder",
		);
	});

	it("refuses a record embedded under an edge its type doesn't declare owns, and an edge the type doesn't declare", () => {
		expect(() => unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m4", from: { "@type": PERSON, id: "alice", name: "Alice" } }, undefined, declarationOf)).toThrow(
			"which its type doesn't declare owns",
		);
		expect(() => unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m4", wroteBy: referenceTo(PERSON, "alice") }, undefined, declarationOf)).toThrow(
			"Message doesn't declare the edge wroteBy",
		);
	});

	it("refuses a reference that isn't a typed CURIE, that states its type beside its id, or that names a type its edge doesn't reach", () => {
		const writing = (from: unknown) => () => unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m6", from }, undefined, declarationOf);
		expect(writing({ "@id": "alice" })).toThrow(`Message's edge from reaches ${PERSON} as Type:id, and its reference is "alice"`);
		expect(writing({ "@type": PERSON, "@id": "alice" })).toThrow("Write the Person on its own, and reference it with referenceTo");
		expect(writing(referenceTo(FOLDER, "alice"))).toThrow(`Message's edge from reaches ${PERSON} as Type:id, and its reference is "${FOLDER}:alice"`);
	});

	it("reads an id that holds colons after the type's prefix", () => {
		const [part] = unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m7", from: referenceTo(PERSON, "did:example:a") }, undefined, declarationOf).parts;
		expect(part?.edges.map(({ label, id }) => `${label} ${id}`)).toEqual([`${PERSON} did:example:a`]);
	});

	it("states the version an update read", () => {
		expect(unitParts(WRITE_VERB.update, { "@type": MESSAGE, "@id": "m5", subject: "again" }, "7", declarationOf).version).toBe("7");
	});
});

describe("a text a type indexes by its digest", () => {
	it("is written with its digest, and a part that doesn't state the text doesn't state a digest", () => {
		const declared = partDeclarationOf({ id: "id", schema: z.object({ id: z.string(), line: z.string() }), edges: {}, digests: { line: "lineDigest" } });
		const written = unitParts(WRITE_VERB.merge, { "@type": "Step", id: "s1", line: "passes" }, undefined, () => declared);
		expect(written.parts[0]?.fields).toEqual({ id: "s1", line: "passes", lineDigest: textDigest("passes") });
		expect(unitParts(WRITE_VERB.merge, { "@type": "Step", id: "s1", other: 1 }, undefined, () => declared).parts[0]?.fields).toEqual({ id: "s1", other: 1 });
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
		).toEqual({ to: [referenceTo(PERSON, "a"), referenceTo(PERSON, "b")], folder: [referenceTo(FOLDER, "inbox")] });
	});
});
