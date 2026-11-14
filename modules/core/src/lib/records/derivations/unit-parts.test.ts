import { describe, expect, it } from "vitest";
import { z } from "zod";
import { referenceTo, WRITE_VERB } from "../domains/unit.js";
import { EDGE_TARGET, edgeDeclarationsOf, type TPartDeclaration } from "./edge-declarations.js";
import { SEQ_PATH_LABEL, type TRecordKey } from "../../domains/resources.js";
import { changedFields, derivedId, edgesAsNode, partDeclarationOf, unitParts } from "./unit-parts.js";
import { contentAddress, contentHash } from "../../domains/content-address.js";

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
			undefined,
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
			{ "@type": MESSAGE, id: "m2", subject: "two", from: ["alice", referenceTo(PERSON, "alice")], to: ["bob", referenceTo(PERSON, "carol")] },
			undefined,
			declarationOf,
			undefined,
		);
		const [part] = unit.parts;
		expect(part?.fields).toEqual({ id: "m2", subject: "two", from: "alice", to: ["bob"] });
		expect(
			part?.edges.map(({ rel, id }) => `${rel} ${id}`),
			"a field and a reference that name one target write one edge",
		).toEqual(["from alice", "to bob", "to carol"]);
		expect(unit.version, "a merge doesn't depend on a read").toBeUndefined();
	});

	it("writes the edge to the record each id of an edge field names, as its declaration states the edge", () => {
		const [part] = unitParts(WRITE_VERB.create, { "@type": MESSAGE, id: "m8", subject: "eight", from: "alice", to: ["bob", "carol"] }, undefined, declarationOf, undefined).parts;
		expect(part?.fields).toEqual({ id: "m8", subject: "eight", from: "alice", to: ["bob", "carol"] });
		expect(part?.edges.map(({ rel, label, id, target }) => `${rel} ${label} ${id} ${target}`)).toEqual([
			`from ${PERSON} alice ${EDGE_TARGET.held}`,
			`to ${PERSON} bob ${EDGE_TARGET.held}`,
			`to ${PERSON} carol ${EDGE_TARGET.held}`,
		]);
		expect(() => unitParts(WRITE_VERB.create, { "@type": MESSAGE, id: "m9", subject: "nine", from: 7 }, undefined, declarationOf, undefined)).toThrow(
			`Message's field "from" names the id of its edge's one target type (${PERSON}), and holds 7`,
		);
	});

	it("doesn't write a field or an edge for an empty list under an edge, and writes an empty field where the schema's field is a list", () => {
		const [part] = unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m3", subject: "three", repliesTo: [], to: [] }, undefined, declarationOf, undefined).parts;
		expect(part?.fields).toEqual({ id: "m3", subject: "three", to: [] });
		expect(part?.edges).toEqual([]);
	});

	it("refuses several literals for a field of one value, and literals beside records where the schema doesn't hold the field", () => {
		expect(() => unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m3", from: ["a", "b", referenceTo(PERSON, "alice")] }, undefined, declarationOf, undefined)).toThrow(
			"Message's edge from holds 2 literals beside its records",
		);
		expect(() => unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m3", folder: ["inbox", referenceTo(FOLDER, "inbox")] }, undefined, declarationOf, undefined)).toThrow(
			"its schema doesn't hold them as its field folder",
		);
	});

	it("refuses a record embedded under an edge its type doesn't declare owns, and an edge the type doesn't declare", () => {
		expect(() => unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m4", from: { "@type": PERSON, id: "alice", name: "Alice" } }, undefined, declarationOf, undefined)).toThrow(
			"which its type doesn't declare owns",
		);
		expect(() => unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m4", wroteBy: referenceTo(PERSON, "alice") }, undefined, declarationOf, undefined)).toThrow(
			"Message doesn't declare the edge wroteBy",
		);
	});

	it("refuses a reference that isn't a typed CURIE, that states its type beside its id, or that names a type its edge doesn't reach", () => {
		const writing = (from: unknown) => () => unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m6", from }, undefined, declarationOf, undefined);
		expect(writing({ "@id": "alice" })).toThrow(`Message's edge from reaches ${PERSON} as Type:id, and its reference is "alice"`);
		expect(writing({ "@type": PERSON, "@id": "alice" })).toThrow("Write the Person on its own, and reference it with referenceTo");
		expect(writing(referenceTo(FOLDER, "alice"))).toThrow(`Message's edge from reaches ${PERSON} as Type:id, and its reference is "${FOLDER}:alice"`);
	});

	it("reads an id that holds colons after the type's prefix", () => {
		const [part] = unitParts(WRITE_VERB.merge, { "@type": MESSAGE, id: "m7", from: referenceTo(PERSON, "did:example:a") }, undefined, declarationOf, undefined).parts;
		expect(part?.edges.map(({ label, id }) => `${label} ${id}`)).toEqual([`${PERSON} did:example:a`]);
	});

	it("states the version an update read", () => {
		expect(unitParts(WRITE_VERB.update, { "@type": MESSAGE, "@id": "m5", subject: "again" }, "7", declarationOf, undefined).version).toBe("7");
	});
});

describe("a text a type indexes by its digest", () => {
	it("is written with its digest, and a part that doesn't state the text doesn't state a digest", () => {
		const declared = partDeclarationOf({ id: "id", schema: z.object({ id: z.string(), line: z.string() }), edges: {}, digests: { line: "lineDigest" } });
		const written = unitParts(WRITE_VERB.merge, { "@type": "Step", id: "s1", line: "passes" }, undefined, () => declared, undefined);
		expect(written.parts[0]?.fields).toEqual({ id: "s1", line: "passes", lineDigest: contentHash("passes") });
		expect(unitParts(WRITE_VERB.merge, { "@type": "Step", id: "s1", other: 1 }, undefined, () => declared, undefined).parts[0]?.fields).toEqual({ id: "s1", other: 1 });
	});
});

describe("a record of a type that declares a key", () => {
	const keyed = (...keys: TRecordKey[]) => partDeclarationOf({ id: "id", keys, schema: z.object({ id: z.string(), email: z.string(), name: z.string() }), edges: {} });
	const byMailbox = keyed({ inverseFunctional: "email" });
	const byContent = keyed({ address: ["name", "email"] });
	const byMailboxOrName = keyed({ inverseFunctional: "email" }, { address: ["name"] });

	it("is identified by the value of its inverse functional field, or the content address of its key's values", () => {
		expect(unitParts(WRITE_VERB.create, { "@type": PERSON, email: "a@example.com", name: "A" }, undefined, () => byMailbox, undefined).record.id).toBe("a@example.com");
		const addressed = unitParts(WRITE_VERB.create, { "@type": PERSON, email: "a@example.com", name: "A" }, undefined, () => byContent, undefined).record.id;
		expect(addressed).toBe(contentAddress(PERSON, ["A", "a@example.com"]));
		expect(addressed).toMatch(/^ni:\/\/\/sha-256;[\w-]{43}$/);
		expect(unitParts(WRITE_VERB.merge, { "@type": PERSON, id: "a@example.com", email: "a@example.com", name: "A" }, undefined, () => byMailbox, undefined).record.id).toBe(
			"a@example.com",
		);
	});

	it("is identified by the first key whose fields it states", () => {
		expect(unitParts(WRITE_VERB.create, { "@type": PERSON, email: "a@example.com", name: "A" }, undefined, () => byMailboxOrName, undefined).record.id).toBe("a@example.com");
		expect(unitParts(WRITE_VERB.create, { "@type": PERSON, name: "A" }, undefined, () => byMailboxOrName, undefined).record.id).toBe(contentAddress(PERSON, ["A"]));
	});

	it("is identified within the record its key's edge names, by that record's type and id", () => {
		const bySource = partDeclarationOf({
			id: "id",
			keys: [{ address: ["wasDerivedFrom", "name"] }],
			schema: z.object({ id: z.string(), name: z.string() }),
			edges: edgeDeclarationsOf({ wasDerivedFrom: { range: [MESSAGE, BODY], reference: true } }),
		});
		const named = (source: ReturnType<typeof referenceTo>) =>
			unitParts(WRITE_VERB.create, { "@type": PERSON, name: "A", wasDerivedFrom: source }, undefined, () => bySource, undefined).record.id;
		expect(named(referenceTo(MESSAGE, "m1"))).toBe(contentAddress(PERSON, [`${MESSAGE}:m1`, "A"]));
		expect(named([referenceTo(MESSAGE, "m1")] as unknown as ReturnType<typeof referenceTo>), "a list of the one target, as a read states it").toBe(
			named(referenceTo(MESSAGE, "m1")),
		);
		expect(named(referenceTo(MESSAGE, "m2")), "a name in another record names another Person").not.toBe(named(referenceTo(MESSAGE, "m1")));
		expect(named(referenceTo(BODY, "m1")), "a record of another type with the same id is another record").not.toBe(named(referenceTo(MESSAGE, "m1")));
	});

	it("is identified by the step in progress where its key reads the step that generated it, as the store's provenance states it", () => {
		const byStep = partDeclarationOf({ id: "id", keys: [{ address: ["wasGeneratedBy", "name"] }], schema: z.object({ id: z.string(), name: z.string() }), edges: {} });
		const written = (step: string | undefined) => unitParts(WRITE_VERB.create, { "@type": PERSON, name: "A" }, undefined, () => byStep, step).record.id;
		expect(written("feature.0.1")).toBe(contentAddress(PERSON, [`${SEQ_PATH_LABEL}:feature.0.1`, "A"]));
		expect(written("feature.0.2"), "a record another step writes is another record").not.toBe(written("feature.0.1"));
		const stated = unitParts(WRITE_VERB.create, { "@type": PERSON, name: "A", wasGeneratedBy: referenceTo(SEQ_PATH_LABEL, "feature.0.1") }, undefined, () => byStep, "feature.0.2");
		expect(stated.record.id, "a record that states its step is identified by that step").toBe(written("feature.0.1"));
		expect(() => written(undefined), "outside a step").toThrow("this create doesn't state it");
	});

	it("refuses an id its writer states that the key doesn't derive, and a create or a merge of fields without the key", () => {
		expect(() => unitParts(WRITE_VERB.create, { "@type": PERSON, id: "peer", email: "a@example.com", name: "A" }, undefined, () => byMailbox, undefined)).toThrow(
			"a Person record's id is derived from its key email, which names a@example.com, and this record states the id peer. Leave the id out",
		);
		expect(() => unitParts(WRITE_VERB.create, { "@type": PERSON, id: "peer", name: "A" }, undefined, () => byMailbox, undefined)).toThrow(
			"a Person record is identified by its key email, and this create doesn't state it. State the key; the store derives the id",
		);
		expect(() => unitParts(WRITE_VERB.merge, { "@type": PERSON, "@id": "peer", name: "A" }, undefined, () => byMailbox, undefined)).toThrow("this merge doesn't state it");
	});

	it("is identified by the same content address where a key's field states a time as a Date or as its ISO text", () => {
		const byTime = partDeclarationOf({ id: "id", keys: [{ address: ["name", "at"] }], schema: z.object({ id: z.string(), name: z.string(), at: z.coerce.date() }), edges: {} });
		const at = new Date("2026-11-13T12:00:00.000Z");
		const written = (stated: unknown) => unitParts(WRITE_VERB.create, { "@type": PERSON, name: "A", at: stated }, undefined, () => byTime, undefined).record.id;
		expect(written(at)).toBe(written(at.toISOString()));
		expect(written(new Date(at.getTime() + 1)), "a record of another time is another record").not.toBe(written(at));
	});

	it("is named before its write by the id its keys derive, and a writer that doesn't state a key's fields is refused", () => {
		expect(derivedId(PERSON, [{ address: ["name"] }], { name: "A" })).toBe(contentAddress(PERSON, ["A"]));
		expect(() => derivedId(PERSON, [{ address: ["name"] }], { email: "a@example.com" })).toThrow("a Person record is identified by its key name, and this record doesn't state it");
		expect(() => derivedId(PERSON, undefined, { name: "A" })).toThrow("Person's type doesn't declare keys");
	});

	it("names a held record by its id in an update, or in a write of its edges alone", () => {
		expect(unitParts(WRITE_VERB.update, { "@type": PERSON, "@id": "a@example.com", name: "B" }, "1", () => byMailbox, undefined).record.id).toBe("a@example.com");
		expect(unitParts(WRITE_VERB.merge, { "@type": PERSON, "@id": "a@example.com" }, undefined, () => byMailbox, undefined).record.id).toBe("a@example.com");
		const mentioning = { "@type": PERSON, "@id": "a@example.com", mentions: referenceTo(MESSAGE, "m1") };
		expect(unitParts(WRITE_VERB.merge, mentioning, undefined, () => byMailbox, undefined).record.id, "and in a write of a vocabulary edge alone").toBe("a@example.com");
	});
});

describe("a part's changed fields", () => {
	it("are the fields whose values differ from what the store holds, and a null where the store holds a value", () => {
		const [part] = unitParts(WRITE_VERB.merge, { "@type": BODY, id: "b2", content: "new", stale: null, kept: 1 }, undefined, declarationOf, undefined).parts;
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
