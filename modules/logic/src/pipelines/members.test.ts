/**
 * The members a class expression entails: the records of each type a named class subsumes through its declared IRI, the records
 * an existential over a property reaches, and the refusal of a property the ontology doesn't hold.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { Access, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { DEF_PROTO_OPTIONS, getTestWorldWithOptions } from "@haibun/core/lib/test/lib.js";
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { reasoner } from "../root.js";
import { entailedMembers, expressionCompletions, subsumes } from "./members.js";

const [STEP, NOTE] = ["Step", "Note"];
const typeOf = (persistedAs: string, type: string) => ({
	selectors: [persistedAs.toLowerCase()],
	schema: z.object({ id: z.string(), content: z.string().optional(), about: z.string().optional(), generatedAtTime: z.string() }),
	description: persistedAs,
	topology: {
		persistedAs,
		type,
		id: "id",
		accessLevel: Access.private,
		properties: { id: LinkRelations.IDENTIFIER.rel, content: LinkRelations.CONTENT.rel },
		edges: { about: { rel: LinkRelations.PART_OF.rel, range: STEP } },
	},
});
const domains = mapDefinitionsToDomains([typeOf(STEP, "prov:Activity"), typeOf(NOTE, "prov:Entity")]);
/** Two steps, and a note about the second. */
const FACTS: [string, string, string, string][] = [
	["s1", "id", "s1", STEP],
	["s2", "id", "s2", STEP],
	["n1", "id", "n1", NOTE],
	["n1", "about", "s2", NOTE],
];

async function storeWith(): Promise<IQuadStore> {
	const store = getTestWorldWithOptions(DEF_PROTO_OPTIONS).shared.getStore();
	for (const [subject, predicate, object, namedGraph] of FACTS) await store.add({ subject, predicate, object, namedGraph, accessLevel: Access.private });
	return store;
}
const members = async (expression: string) => entailedMembers(reasoner(), await storeWith(), domains, expression);
const sorted = (found: { persistedAs: string; id: string }[]) => found.map(({ persistedAs, id }) => `${persistedAs}:${id}`).sort();

describe("entailedMembers", () => {
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
	const subsumed = async (sub: string, sup: string) => subsumes(reasoner(), await storeWith(), domains, sub, sup);
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
