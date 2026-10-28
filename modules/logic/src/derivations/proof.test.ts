/**
 * EYE's proof as structured steps, read by N3.js: the proof's conclusion, each inference with its evidence and rule, each
 * extraction with its source, and a rule's formula giving an empty list of triples. The proof is the one EYE writes for
 * `:a a :Step` and the rule from a step to an activity.
 */
import { describe, expect, it } from "vitest";
import type { Quad, Term } from "@rdfjs/types";
import { NAMESPACE, RDF } from "@haibun/core/lib/domains/vocabularies.js";
import { proofOf } from "./proof.js";

const R = NAMESPACE.r;
const TYPE = `<${RDF.type}>`;
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

const value = (n3: string): string => n3.slice(1, -1);
/** A quad's subject, predicate and object, each by its value. */
const triple = ({ subject, predicate, object }: Quad) => [subject.value, predicate.value, object.value];
const activity = [value(A), RDF.type, value(ACTIVITY)];

describe("proofOf", () => {
	it("reads the proof's conclusion and each step with its evidence, its rule and its source", () => {
		const { gives, steps, text } = proofOf(PROOF);
		expect(gives.map(triple)).toEqual([activity]);
		expect(text).toBe(PROOF);
		const values = (terms: readonly Term[]) => terms.map((term) => term.value);
		expect(
			steps.map(({ step, kind, gives: held, evidence, rule: applied, source }) => ({
				step: step.value,
				kind,
				gives: held.map(triple),
				evidence: values(evidence),
				rule: applied?.value,
				source: source?.value,
			})),
		).toEqual([
			{ step: value(lemma("proof")), kind: "proof", gives: [activity], evidence: [value(lemma(1))], rule: undefined, source: undefined },
			{ step: value(lemma(1)), kind: "inference", gives: [activity], evidence: [value(lemma(2))], rule: value(lemma(3)), source: undefined },
			{ step: value(lemma(2)), kind: "inference", gives: [activity], evidence: [value(lemma(4))], rule: value(lemma(5)), source: undefined },
			{ step: value(lemma(3)), kind: "extraction", gives: [], evidence: [], rule: undefined, source: "file:///query.n3" },
			{ step: value(lemma(4)), kind: "extraction", gives: [[value(A), RDF.type, value(STEP)]], evidence: [], rule: undefined, source: "file:///sources.n3" },
			{ step: value(lemma(5)), kind: "extraction", gives: [], evidence: [], rule: undefined, source: "file:///sources.n3" },
		]);
	});

	it("reads empty text as a proof that gives an empty list, since EYE writes an empty text where the query selects an empty set", () => {
		expect(proofOf("")).toEqual({ gives: [], steps: [], text: "" });
	});

	it("refuses text that doesn't state its proof, and a statement cut short", () => {
		expect(() => proofOf(extraction(4, `${A} ${TYPE} ${STEP}.`, "sources.n3"))).toThrow(/doesn't state its proof/);
		expect(() => proofOf(`${lemma(1)} <${R}gives> { ${A} ${TYPE}`)).toThrow();
	});
});
