/**
 * The members a class expression entails: the records of each type a named class subsumes through its declared IRI, the records
 * an existential over a property reaches, and the refusal of a property the ontology doesn't hold.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { Access, GeneratedAtTimeSchema, HAIBUN_RECORD_NAMESPACE, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { storeOfDomains } from "@haibun/core/lib/test/declared-types.js";
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { reasoner } from "../root.js";
import { countedMembers, entailedMembers, expressionCompletions, subsumes, truncationOf } from "./members.js";
import { REASONING_READ_CEILING } from "../domains/reasoning.js";
import type { TWorld } from "@haibun/core/lib/actuality/domains/world.js";
import { readRecordQuery } from "@haibun/core/lib/records/pipelines/record-query.js";

const [STEP, NOTE] = ["Step", "Note"];
const typeOf = (persistedAs: string, type: string) => ({
	selectors: [persistedAs.toLowerCase()],
	schema: z.object({ id: z.string(), content: z.string().optional(), kind: z.string().optional(), about: z.string().optional(), generatedAtTime: GeneratedAtTimeSchema }),
	description: persistedAs,
	topology: {
		persistedAs,
		type,
		id: "id",
		accessLevel: Access.private,
		properties: { id: LinkRelations.IDENTIFIER.rel, content: LinkRelations.CONTENT.rel, kind: LinkRelations.CONTEXT.rel },
		edges: { about: { rel: LinkRelations.PART_OF.rel, range: STEP } },
	},
});
const definitions = [typeOf(STEP, "prov:Activity"), typeOf(NOTE, "prov:Entity")];
const domains = mapDefinitionsToDomains(definitions);
/** Two steps, and a note about the second. */
const FACTS: [string, string, string, string][] = [
	["s1", "id", "s1", STEP],
	["s2", "id", "s2", STEP],
	["n1", "id", "n1", NOTE],
	["n1", "about", "s2", NOTE],
];

async function storeWith(): Promise<IQuadStore> {
	const store = storeOfDomains(definitions);
	for (const [subject, predicate, object, namedGraph] of FACTS) await store.add({ subject, predicate, object, namedGraph, accessLevel: Access.private });
	return store;
}
/** A store that refuses a read of quads without a key, as a store that indexes its records by key does, and serves reads of records. */
const keyedOnly = (store: IQuadStore): IQuadStore =>
	new Proxy(store, {
		get: (target, property, receiver) =>
			property === "query"
				? (pattern: { subject?: unknown }) => (pattern.subject === undefined ? Promise.reject(new Error("a read of quads names a subject")) : target.query(pattern as never))
				: Reflect.get(target, property, receiver),
	});
const entailed = async (expression: string) => entailedMembers(reasoner(), keyedOnly(await storeWith()), domains, HAIBUN_RECORD_NAMESPACE, expression);
const members = async (expression: string) => (await entailed(expression)).members;
const sorted = (found: { persistedAs: string; id: string }[]) => found.map(({ persistedAs, id }) => `${persistedAs}:${id}`).sort();

describe("entailedMembers", () => {
	it("reads each type's records in pages through the store's read of records, from a store that refuses reads without a key", { timeout: 30_000 }, async () => {
		expect(await entailed("Step")).toMatchObject({ truncated: [] });
		expect(countedMembers(await entailed("Step")), "a count of what the reads entail").toMatchObject({ total: 2, saturated: false });
	});

	it("states the types whose reads stopped at the ceiling, as a floor of the count and in an unknown claim's reason", () => {
		const stopped = { members: [], truncated: [STEP] };
		expect(countedMembers(stopped)).toEqual({ members: [], total: 0, saturated: true });
		expect(truncationOf(stopped)).toBe(` The reads of ${STEP} stopped at ${REASONING_READ_CEILING} records, and the records after them weren't read.`);
		expect(truncationOf({ members: [], truncated: [] })).toBe("");
	});

	it("returns the records of each type a named class subsumes, through the IRI the type declares", { timeout: 30_000 }, async () => {
		expect(sorted(await members("prov:Activity"))).toEqual(["Step:s1", "Step:s2"]);
		expect(sorted(await members("Note or Step"))).toEqual(["Note:n1", "Step:s1", "Step:s2"]);
	});

	it("returns the records an existential over a property reaches, and the records it names by value", { timeout: 30_000 }, async () => {
		expect(sorted(await members(`${LinkRelations.PART_OF.rel} some Step`))).toEqual(["Note:n1"]);
		expect(sorted(await members(`Note and ${LinkRelations.PART_OF.rel} value Step:s2`))).toEqual(["Note:n1"]);
		expect(await members(`${LinkRelations.PART_OF.rel} value Step:s1`)).toEqual([]);
	});

	it("refuses a property the ontology doesn't hold, with the nearest", async () => {
		await expect(members("burnt some Step")).rejects.toThrow(/doesn't hold the property burnt. Did you mean/);
	});
});

describe("subsumes", () => {
	const subsumed = async (sub: string, sup: string) => subsumes(reasoner(), await storeWith(), domains, HAIBUN_RECORD_NAMESPACE, sub, sup);
	it("holds where a member that stands for any member of the first is a member of the second", { timeout: 30_000 }, async () => {
		expect(await subsumed("Step", "prov:Activity")).toBe(true);
		expect(await subsumed(`Note and ${LinkRelations.PART_OF.rel} some Step`, "prov:Entity")).toBe(true);
		expect(await subsumed("Note or Step", "Note or Step")).toBe(true);
	});
	it("doesn't hold where the ontology doesn't entail it", { timeout: 30_000 }, async () => {
		expect(await subsumed("Note", "prov:Activity")).toBe(false);
		expect(await subsumed("Note or Step", "Note")).toBe(false);
	});
});

describe("expressionCompletions", () => {
	it("offers each class or property name that begins with the expression's last word, in its place", () => {
		expect(expressionCompletions("Not", domains)).toEqual(["Note"]);
		expect(expressionCompletions("Note and St", domains)).toEqual(["Note and Step"]);
		expect(expressionCompletions("Note and ", domains), "a word isn't begun").toEqual([]);
	});
});

describe("a record query's expression", () => {
	/** A world whose prover entails members through the reasoner, over the store a test writes. */
	const worldOver = (store: IQuadStore) =>
		({
			domains,
			runtime: {
				records: HAIBUN_RECORD_NAMESPACE,
				prover: { entailed: (_world: unknown, text: string) => entailedMembers(reasoner(), store, domains, HAIBUN_RECORD_NAMESPACE, text) },
			},
		}) as unknown as TWorld;

	it("runs a field's value on the store's index, and the part that needs entailment through the reasoner, stating where each ran", { timeout: 30_000 }, async () => {
		const store = await storeWith();
		for (const [predicate, object] of [
			["id", "n2"],
			["kind", "kept"],
		] as const)
			await store.add({ subject: "n2", predicate, object, namedGraph: NOTE, accessLevel: Access.private });
		const read = (text: string) => readRecordQuery(worldOver(store), { label: NOTE, expression: text }, (query) => store.readRecords(query));
		expect(await read('kind value "kept"')).toMatchObject({ vertices: [{ id: "n2" }], ran: { index: 'kind value "kept"' } });
		expect(await read("about some Step")).toMatchObject({ vertices: [{ id: "n1" }], ran: { reasoner: "about some Step" } });
		expect(await read("about only Step")).toMatchObject({ refused: expect.stringMatching(/uses `only`/) });
	});
});
