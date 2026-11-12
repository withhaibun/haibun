import { describe, expect, it } from "vitest";
import { RECORDED_STATUS, VERDICT } from "../../domains/protocol.js";
import { SEQ_PATH_FIELD } from "../../actuality/domains/seq-path.js";
import { endRecord } from "../../actuality/derivations/step-records.js";
import { REASONING_TASK } from "../domains/claim.js";
import { parseClassExpression } from "./class-expression.js";
import { UNDETERMINED, claimResult, claimText, entailmentOf, entailmentRecorded } from "./claim.js";

const parsed = parseClassExpression;

describe("a claim's entailment", () => {
	it("reads `individual X is a E` as an instance check of ClassAssertion(E X)", () => {
		expect(entailmentOf({ individual: "SeqPath:s1", type: parsed("SeqPath") })).toEqual({
			task: REASONING_TASK.instance,
			functional: "ClassAssertion(SeqPath SeqPath:s1)",
			manchester: "Individual: SeqPath:s1 Types: SeqPath",
			entails: "K ⊨ ClassAssertion(SeqPath SeqPath:s1)",
			dl: "K ⊨ SeqPath:s1 ∈ SeqPath",
		});
	});

	it("reads `every E1 is a E2` over a named class as a subsumption check of SubClassOf(E1 E2), with its Manchester frame", () => {
		expect(entailmentOf({ sub: parsed("SeqPath"), sup: parsed("Comment") })).toEqual({
			task: REASONING_TASK.subsumption,
			functional: "SubClassOf(SeqPath Comment)",
			manchester: "Class: SeqPath SubClassOf: Comment",
			entails: "K ⊨ SubClassOf(SeqPath Comment)",
			dl: "K ⊨ SeqPath ⊑ Comment",
		});
	});

	it("reads `every E1 is a E2` over a complex expression as SubClassOf alone, since Manchester syntax doesn't state a frame for it", () => {
		expect(entailmentOf({ sub: parsed("SeqPath and isPartOf some SeqPath"), sup: parsed("SeqPath") })).toEqual({
			task: REASONING_TASK.subsumption,
			functional: "SubClassOf(ObjectIntersectionOf(SeqPath ObjectSomeValuesFrom(isPartOf SeqPath)) SeqPath)",
			entails: "K ⊨ SubClassOf(ObjectIntersectionOf(SeqPath ObjectSomeValuesFrom(isPartOf SeqPath)) SeqPath)",
			dl: "K ⊨ SeqPath ⊓ ∃isPartOf.SeqPath ⊑ SeqPath",
		});
	});

	it("reads `some E` as an instance retrieval, which doesn't check an axiom", () => {
		expect(entailmentOf({ some: parsed("inverse isPartOf some SeqPath or Comment") })).toEqual({
			task: REASONING_TASK.retrieval,
			entails: "∃a. K ⊨ ClassAssertion(ObjectUnionOf(ObjectSomeValuesFrom(ObjectInverseOf(isPartOf) SeqPath) Comment) a)",
			dl: "∃a. K ⊨ a ∈ ∃isPartOf⁻.SeqPath ⊔ Comment",
		});
	});

	it("writes a value, a literal and a datatype restriction in OWL 2 functional syntax", () => {
		const functional = (text: string) => entailmentOf({ some: parsed(text) }).entails;
		expect(functional("isPartOf value SeqPath:s1")).toContain("ObjectHasValue(isPartOf SeqPath:s1)");
		expect(functional('stepText value "go"')).toContain('DataHasValue(stepText "go")');
		expect(functional("duration some xsd:integer[>= 5, < 9]")).toContain(
			'DataSomeValuesFrom(duration DatatypeRestriction(xsd:integer xsd:minInclusive "5"^^xsd:integer xsd:maxExclusive "9"^^xsd:integer))',
		);
	});
});

describe("a claim's result", () => {
	const entailment = entailmentOf({ individual: "SeqPath:s1", type: parsed("Comment") });

	it("passes where the claim holds, and its products and record state the task, the entailment, the verdict and the proof", () => {
		const result = claimResult(entailment, VERDICT.proved, "the reasoner entails it");
		expect(result.ok).toBe(true);
		expect(entailmentRecorded(result.products)).toEqual({ entailment: "instance check · K ⊨ ClassAssertion(Comment SeqPath:s1) · holds · the reasoner entails it" });
	});

	it("is unknown where K doesn't entail the axiom and doesn't contradict it, and keeps its own products", () => {
		const result = claimResult(entailment, VERDICT.unknown, UNDETERMINED, { witness: "w" });
		expect([result.ok, result.verdict, result.products?.witness]).toEqual([false, VERDICT.unknown, "w"]);
		expect(result.errorMessage).toBe(`instance check · K ⊨ ClassAssertion(Comment SeqPath:s1) · unknown · ${UNDETERMINED}`);
	});

	it("is refuted where the axiom contradicts the knowledge", () => {
		const result = claimResult(entailment, VERDICT.refuted, "K entails its complement");
		expect([result.ok, result.verdict]).toEqual([false, undefined]);
		expect(result.errorMessage).toContain("· refuted · K entails its complement");
	});

	it("reads a feature claim that holds as holding for every value of its domains, with the claim's sentence", () => {
		const over = [
			{ name: "c", domain: "Capability" },
			{ name: "r", domain: "Capability" },
		];
		const featured = entailmentOf({ feature: "chain", claim: "allowsWithin(c, r)", sentence: "c allows within r", over });
		expect(featured).toMatchObject({
			task: REASONING_TASK.feature,
			sentence: "c allows within r",
			dl: "∀c: Capability, r: Capability. chain ⊨ allowsWithin(c, r)",
			domains: ["Capability"],
		});
		expect(claimText({ ...featured, verdict: VERDICT.proved, proof: "p" })).toBe(
			"feature entailment · c allows within r · chain ⊨ allowsWithin(c, r) · holds for every Capability · p",
		);
		expect(claimText({ ...featured, verdict: VERDICT.unknown, proof: "p" })).toContain(" · unknown · p");
	});

	it("is stated on the step's record, and a step without a claim doesn't state one", () => {
		const claim = { ...entailment, verdict: VERDICT.proved, proof: "p" } as const;
		const start = { [SEQ_PATH_FIELD.id]: "s" };
		expect(endRecord(start, { status: RECORDED_STATUS.completed, ...entailmentRecorded({ claim }) }, "t")[SEQ_PATH_FIELD.entailment]).toBe(claimText(claim));
		expect(entailmentRecorded({ members: [] })).toEqual({});
	});
});
