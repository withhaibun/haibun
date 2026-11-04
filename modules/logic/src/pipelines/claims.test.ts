/**
 * A claim K contradicts is refuted: a membership or a subsumption that implies two classes a standard vocabulary states disjoint,
 * through the superclasses the types declare, names the axioms the reasoner's proof of the contradiction read. A claim that
 * doesn't contradict a disjointness stays unknown, since a standard that doesn't state a disjointness leaves its classes open.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { Access, GeneratedAtTimeSchema, HAIBUN_RECORD_NAMESPACE, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { VERDICT, type TActionResult } from "@haibun/core/lib/domains/protocol.js";
import { ClaimProductsSchema } from "@haibun/core/lib/records/domains/claim.js";
import { ClaimWitnessSchema } from "@haibun/core/lib/records/domains/axioms.js";
import { storeOfDomains } from "@haibun/core/lib/test/declared-types.js";
import { reasoner } from "../root.js";
import { instanceChecked, subsumptionChecked, type TClaimScope } from "./claims.js";

const [STEP, NOTE, PERSON] = ["Step", "Note", "Person"];
const typeOf = (persistedAs: string, subClassOf: string) => ({
	selectors: [persistedAs.toLowerCase()],
	schema: z.object({ id: z.string(), generatedAtTime: GeneratedAtTimeSchema }),
	description: persistedAs,
	topology: { persistedAs, subClassOf, id: "id", accessLevel: Access.private, properties: { id: LinkRelations.IDENTIFIER.rel } },
});
const definitions = [typeOf(STEP, "prov:Activity"), typeOf(NOTE, "prov:Entity"), typeOf(PERSON, "prov:Agent")];
const domains = mapDefinitionsToDomains(definitions);

async function scopeWith(): Promise<TClaimScope> {
	const store = storeOfDomains(definitions);
	for (const [subject, namedGraph] of [
		["s1", STEP],
		["n1", NOTE],
	] as const)
		await store.add({ subject, predicate: "id", object: subject, namedGraph, accessLevel: Access.private });
	return { reasoner: reasoner(), store, domains, records: HAIBUN_RECORD_NAMESPACE };
}
const outcomeOf = (result: TActionResult) => ClaimProductsSchema.parse(result.products).claim;
/** The axioms that refute a Note's membership of Step: PROV-O's disjointness, and the superclass each type declares. */
const DISJOINT = "DisjointClasses(prov:Activity prov:Entity), SubClassOf(Note prov:Entity), SubClassOf(Step prov:Activity)";

describe("claims K contradicts", () => {
	it("refutes an instance check that contradicts a disjointness, naming the standard's axiom, the superclasses and the record's type", { timeout: 60_000 }, async () => {
		const result = await instanceChecked(await scopeWith(), { persistedAs: NOTE, id: "n1" }, STEP);
		expect(result.ok).toBe(false);
		const { verdict, proof } = outcomeOf(result);
		expect(verdict).toBe(VERDICT.refuted);
		expect(proof).toContain(`from ClassAssertion(Note Note:n1), ${DISJOINT}`);
		expect(result.ok ? "" : result.errorMessage).toContain(`instance check · K ⊨ ClassAssertion(Step Note:n1) · refuted · ${proof}`);
	});

	it("refutes a subsumption whose classes are disjoint where a member exists, with the member as its witness", { timeout: 60_000 }, async () => {
		const result = await subsumptionChecked(await scopeWith(), NOTE, STEP);
		const { verdict, proof } = outcomeOf(result);
		expect(verdict).toBe(VERDICT.refuted);
		expect(proof).toBe(
			`the reasoner entails its contradiction under the rules of OWL 2 RL, since a member is entailed a member of two disjoint classes (the rule cax-dw), from ${DISJOINT}, and the witness that exceeds it is Note:n1`,
		);
		expect(ClaimWitnessSchema.parse(z.object({ witness: z.unknown() }).parse(result.products).witness).members).toEqual([{ persistedAs: NOTE, id: "n1" }]);
	});

	it("leaves unknown a claim whose classes a standard doesn't state disjoint, as PROV-O doesn't state an entity and an agent", { timeout: 60_000 }, async () => {
		const result = await instanceChecked(await scopeWith(), { persistedAs: NOTE, id: "n1" }, PERSON);
		expect(outcomeOf(result).verdict).toBe(VERDICT.unknown);
	});
});
