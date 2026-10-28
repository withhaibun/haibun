/**
 * EYE's proof as structured steps: the proof's conclusion, each inference with its evidence and rule, each extraction with
 * its source, and a rule's formula giving an empty list of triples. The proof is the one EYE writes for `:a a :Step` and the rule from a
 * step to an activity.
 */
import { describe, expect, it } from "vitest";
import { proofOf } from "./proof.js";

const R = "http://www.w3.org/2000/10/swap/reason#";
const TYPE = "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>";
const [ACTIVITY, STEP, A, X] = ["<urn:t#Activity>", "<urn:t#Step>", "<urn:t#a>", "<http://www.w3.org/2000/10/swap/var#x_0>"];
const lemma = (n: number | string) => `<urn:genid#${n}>`;
const extraction = (n: number, gives: string, source: string) =>
	`${lemma(n)} ${TYPE} <${R}Extraction>;\n <${R}gives> { ${gives} };\n <${R}because> [ ${TYPE} <${R}Parsing>; <${R}source> <file:///${source}>].`;
const rule = (from: string, to: string) => `@forAll ${X}. { ${X} ${TYPE} ${from}. } => { ${X} ${TYPE} ${to}. }.`;
const inference = (n: number, evidence: number, ruleOf: number) =>
	`${lemma(n)} ${TYPE} <${R}Inference>;\n <${R}gives> { ${A} ${TYPE} ${ACTIVITY}. };\n <${R}evidence> ( ${lemma(evidence)} );\n` +
	` <${R}binding> [ <${R}variable> [ <http://www.w3.org/2004/06/rei#uri> "${X.slice(1, -1)}"]; <${R}boundTo> [ <http://www.w3.org/2004/06/rei#uri> "urn:t#a"]];\n <${R}rule> ${lemma(ruleOf)}.`;
const PROOF = [
	`${lemma("proof")} ${TYPE} <${R}Proof>, <${R}Conjunction>;\n <${R}component> ${lemma(1)};\n <${R}gives> { ${A} ${TYPE} ${ACTIVITY}. }.`,
	inference(1, 2, 3),
	inference(2, 4, 5),
	extraction(3, rule(ACTIVITY, ACTIVITY), "query.n3"),
	extraction(4, `${A} ${TYPE} ${STEP}.`, "sources.n3"),
	extraction(5, rule(STEP, ACTIVITY), "sources.n3"),
].join("\n\n");
const activity = { subject: A, predicate: TYPE, object: ACTIVITY };

describe("proofOf", () => {
	it("reads the proof's conclusion and each step with its evidence, its rule and its source", () => {
		const { gives, steps } = proofOf(PROOF);
		expect(gives).toEqual([activity]);
		expect(steps).toEqual([
			{ step: lemma("proof"), kind: "proof", gives: [activity], evidence: [lemma(1)] },
			{ step: lemma(1), kind: "inference", gives: [activity], evidence: [lemma(2)], rule: lemma(3) },
			{ step: lemma(2), kind: "inference", gives: [activity], evidence: [lemma(4)], rule: lemma(5) },
			{ step: lemma(3), kind: "extraction", gives: [], evidence: [], source: "<file:///query.n3>" },
			{ step: lemma(4), kind: "extraction", gives: [{ subject: A, predicate: TYPE, object: STEP }], evidence: [], source: "<file:///sources.n3>" },
			{ step: lemma(5), kind: "extraction", gives: [], evidence: [], source: "<file:///sources.n3>" },
		]);
	});

	it("reads empty text as a proof that gives an empty list, since EYE writes an empty text where the query selects an empty set", () => {
		expect(proofOf("")).toEqual({ gives: [], steps: [] });
	});

	it("refuses text that doesn't state its proof, a step without a kind, and a statement cut short", () => {
		expect(() => proofOf(extraction(4, `${A} ${TYPE} ${STEP}.`, "sources.n3"))).toThrow(/doesn't state its proof/);
		expect(() => proofOf(`${A} ${TYPE} ${STEP}.`)).toThrow(/without a kind of step/);
		expect(() => proofOf(`${lemma(1)} <${R}gives> { ${A} ${TYPE}`)).toThrow(/ended inside a statement/);
	});
});
