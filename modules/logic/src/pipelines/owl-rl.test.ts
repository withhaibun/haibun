/**
 * The OWL 2 RL rules a reasoning reads: two individuals with one value of an inverse functional property are the same
 * individual (prp-ifp), and individuals with different values aren't derived the same.
 */
import { describe, expect, it } from "vitest";
import { NAMESPACE, OWL } from "@haibun/core/lib/domains/vocabularies.js";
import { RULE_SET } from "../domains/reasoning.js";
import { reasoner } from "../root.js";

const MBOX = `<${NAMESPACE.foaf}mbox>`;
const PREFIXES = "@prefix : <urn:x:> .\n";
const SAME = `{ ?a <${OWL.sameAs}> ?b } => { ?a <${OWL.sameAs}> ?b } .`;
const derivedOf = (facts: string): Promise<string> =>
	reasoner().session(async (session) => {
		const state = await session.start(`${reasoner().rules(RULE_SET.owlRl)}\n${PREFIXES}${MBOX} a <${OWL.InverseFunctionalProperty}> .\n${facts}`, `${PREFIXES}${SAME}`, false);
		if (!("derived" in state)) throw new Error("the rules of OWL 2 RL don't read a fact outside the session");
		return state.derived;
	});

describe("the OWL 2 RL rule set", () => {
	it("derives that two individuals with one value of an inverse functional property are the same individual", { timeout: 60_000 }, async () => {
		const derived = await derivedOf(`:p1 ${MBOX} <mailto:a@example.org> . :p2 ${MBOX} <mailto:a@example.org> . :p3 ${MBOX} <mailto:b@example.org> .`);
		expect(derived).toContain(`<urn:x:p1> <${OWL.sameAs}> <urn:x:p2>`);
		expect(derived).not.toContain(`<urn:x:p1> <${OWL.sameAs}> <urn:x:p3>`);
	});
});
