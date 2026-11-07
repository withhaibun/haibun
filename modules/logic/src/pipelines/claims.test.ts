/**
 * A claim K contradicts is refuted: a membership or a subsumption that implies two classes a standard vocabulary states disjoint,
 * through the superclasses the types declare, names the axioms the reasoner's proof of the contradiction read. A claim that
 * doesn't contradict a disjointness stays unknown, since a standard that doesn't state a disjointness leaves its classes open.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { VERDICT, type TActionResult } from "@haibun/core/lib/domains/protocol.js";
import { ClaimProductsSchema } from "@haibun/core/lib/records/domains/claim.js";
import { ClaimWitnessSchema, DisjointnessWitnessSchema } from "@haibun/core/lib/records/domains/axioms.js";
import { reasoner } from "../root.js";
import { instanceChecked, subsumptionChecked } from "./claims.js";
import { NOTE, PERSON, STEP, scopeWith } from "../test/claim-scope.js";

const outcomeOf = (result: TActionResult) => ClaimProductsSchema.parse(result.products).claim;
/** The axioms that refute a Note's membership of Step: PROV-O's disjointness, and the superclass each type declares. */
const DISJOINT = "DisjointClasses(prov:Activity prov:Entity) (PROV-O W3C Recommendation 2013-04-30), SubClassOf(Note prov:Entity), SubClassOf(Step prov:Activity)";

describe("claims K contradicts", () => {
	it("refutes an instance check that contradicts a disjointness, naming the standard's axiom, the superclasses and the record's type", { timeout: 60_000 }, async () => {
		const result = await instanceChecked(await scopeWith(reasoner()), { persistedAs: NOTE, id: "n1" }, STEP);
		expect(result.ok).toBe(false);
		const { verdict, proof } = outcomeOf(result);
		expect(verdict).toBe(VERDICT.refuted);
		expect(proof).toContain(`from ClassAssertion(Note Note:n1), ${DISJOINT}`);
		expect(result.ok ? "" : result.errorMessage).toContain(`instance check · K ⊨ ClassAssertion(Step Note:n1) · refuted · ${proof}`);
		expect(DisjointnessWitnessSchema.parse(z.object({ witness: z.unknown() }).parse(result.products).witness), "the clash the DL view lights").toEqual({
			individual: { persistedAs: NOTE, id: "n1" },
			disjoint: ["prov:Activity", "prov:Entity"],
			statedBy: "PROV-O W3C Recommendation 2013-04-30",
		});
	});

	it("refutes a subsumption whose classes are disjoint where a member exists, with the member as its witness", { timeout: 60_000 }, async () => {
		const result = await subsumptionChecked(await scopeWith(reasoner()), NOTE, STEP);
		const { verdict, proof } = outcomeOf(result);
		expect(verdict).toBe(VERDICT.refuted);
		expect(proof).toBe(
			`the reasoner entails its contradiction under the rules of OWL 2 RL, since a member is entailed a member of two disjoint classes (the rule cax-dw), from ${DISJOINT}, and the witness that exceeds it is Note:n1`,
		);
		expect(ClaimWitnessSchema.parse(z.object({ witness: z.unknown() }).parse(result.products).witness).members).toEqual([{ persistedAs: NOTE, id: "n1" }]);
	});

	it("leaves unknown a claim whose classes a standard doesn't state disjoint, as PROV-O doesn't state an entity and an agent", { timeout: 60_000 }, async () => {
		const result = await instanceChecked(await scopeWith(reasoner()), { persistedAs: NOTE, id: "n1" }, PERSON);
		expect(outcomeOf(result).verdict).toBe(VERDICT.unknown);
	});
});
