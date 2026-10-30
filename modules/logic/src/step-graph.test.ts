/**
 * The logic module's stepper held to the typed step graph its baseline records: each finding of the chain lint about it is
 * one the file names, and a finding fixed is removed from it. Each step's signature states its rule, which the goals' facts
 * write: a step that returns D and takes D₁ … is a producer of D whose proof takes D₁ … (review RC4).
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { expectStepGraphAsRecorded } from "./test/step-graph-baseline.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import LogicStepper from "./logic-stepper.js";
import { stepSignatures, goalFactsOf } from "./derivations/goals.js";
import { domainIri, goalFacts, stepIri } from "./derivations/goal-rules.js";
import { listItems, quadsOf } from "./derivations/n3.js";
import { REASONER_NAMESPACE } from "./domains/reasoning.js";

/** What a caller who may call every step holds. */
const EVERY_ACTION = "*";

describe("the typed step graph of the logic module's stepper", () => {
	it("has only the findings its baseline records", { timeout: 60_000 }, async () => {
		await expectStepGraphAsRecorded({
			owned: [LogicStepper],
			alongside: [Haibun],
			baselineFile: path.join(import.meta.dirname, "step-graph.baseline.json"),
			sourceDir: import.meta.dirname,
		});
	});

	it("states each step's rule from its signature: the domains it takes, and itself among the producers of each domain it returns", () => {
		const signatures = stepSignatures([new LogicStepper(), new Haibun()]);
		const quads = quadsOf(goalFacts(goalFactsOf(signatures, {}, EVERY_ACTION, [], [])));
		const objectOf = (subject: string, predicate: string) =>
			quads.find((quad) => quad.subject.value === subject && quad.predicate.value === `${REASONER_NAMESPACE}${predicate}`)?.object;
		const itemsOf = (subject: string, predicate: string): string[] => {
			const node = objectOf(subject, predicate);
			return node === undefined ? [] : listItems(quads, node).map(({ value }) => value);
		};
		const producing = signatures.filter(({ outputDomains }) => outputDomains.length > 0);
		expect(producing.length, "the steppers hold steps that return a domain").toBeGreaterThan(0);
		for (const { method, inputDomains, outputDomains } of producing) {
			expect(itemsOf(stepIri(method).value, "takes"), method).toEqual(inputDomains.map((domain) => domainIri(domain).value));
			for (const output of outputDomains) expect(itemsOf(domainIri(output).value, "producers"), `${method} returns ${output}`).toContain(stepIri(method).value);
		}
	});
});
