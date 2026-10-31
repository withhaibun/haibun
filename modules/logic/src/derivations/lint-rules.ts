/**
 * The facts of the step graph's lint, which `src/rules/lint.n3` reads, and the findings the query's quads state.
 */
import { DataFactory } from "n3";
import type { Quad } from "@rdfjs/types";
import { RDF } from "@haibun/core/lib/domains/vocabularies.js";
import { LINT_FINDING, LintFindingSchema, type TLintFinding } from "@haibun/core/lib/domains/goal-resolution.js";
import { REASONER_NAMESPACE } from "../domains/reasoning.js";
import { DIFFERENT_BUILDS } from "../domains/logic.js";
import { domainIri, domainOf, stepIri } from "./goal-rules.js";
import { listItems, pattern, patternText, termIn, termOf } from "./n3.js";

const { namedNode, literal } = DataFactory;
const h = termIn(REASONER_NAMESPACE);
/** The terms of the step graph's facts and of a finding, as `src/rules/lint.n3` names them. */
const LINT_TERM = {
	stepper: h("stepper"),
	stepName: h("stepName"),
	input: h("input"),
	output: h("output"),
	node: h("node"),
	written: h("written"),
	beyond: h("beyond"),
	persisted: h("persisted"),
	refersTo: h("refersTo"),
	part: h("part"),
	fieldRange: h("fieldRange"),
	graph: h("graph"),
	addressDomain: h("addressDomain"),
	finding: h("Finding"),
};
const L = LINT_TERM;
const yes = termOf(true);

/** A step as the lint reads it: its stepper, its name, its method, and the domains it takes and returns. */
export type TLintStep = { stepperName: string; stepName: string; method: string; inputs: readonly string[]; outputs: readonly string[] };
/** A domain as the lint reads it: whether it is a node of the graph, written by its caller, read beyond its steps and persisted. */
export type TLintDomain = { key: string; node: boolean; written: boolean; beyond: boolean; persisted: boolean };
/** The step graph the lint reads: its steps, its domains, each reference, each union's parts, each composite's field ranges, and
 *  the domain of an individual's address. */
export type TLintGraph = {
	steps: readonly TLintStep[];
	domains: readonly TLintDomain[];
	refs: readonly [string, string][];
	parts: readonly [string, string][];
	ranges: readonly [string, string][];
	address: string;
};

/** Returns the step graph's facts as N3. A flag a domain doesn't hold isn't stated, so a rule reads it through scoped negation. */
export function lintFacts({ steps, domains, refs, parts, ranges, address }: TLintGraph): string {
	const flags = (["node", "written", "beyond", "persisted"] as const).flatMap((flag) =>
		domains.filter((domain) => domain[flag]).map((domain) => pattern(domainIri(domain.key), L[flag], yes)),
	);
	return [
		...steps.flatMap(({ stepperName, stepName, method, inputs, outputs }) => [
			pattern(stepIri(method), L.stepper, literal(stepperName)),
			pattern(stepIri(method), L.stepName, literal(stepName)),
			...inputs.map((input) => pattern(stepIri(method), L.input, domainIri(input))),
			...outputs.map((output) => pattern(stepIri(method), L.output, domainIri(output))),
		]),
		...flags,
		...refs.map(([from, to]) => pattern(domainIri(from), L.refersTo, domainIri(to))),
		...parts.map(([union, part]) => pattern(domainIri(union), L.part, domainIri(part))),
		...ranges.map(([composite, range]) => pattern(domainIri(composite), L.fieldRange, domainIri(range))),
		pattern(L.graph, L.addressDomain, domainIri(address)),
	]
		.map(patternText)
		.join("\n");
}

/** Returns the findings the query's quads state. */
export function lintFindingsOf(quads: readonly Quad[]): TLintFinding[] {
	return quads.flatMap(({ subject, predicate, object }) => {
		if (!predicate.equals(namedNode(RDF.type)) || !object.equals(L.finding)) return [];
		const [kind, ...items] = listItems(quads, subject);
		if (kind?.value === LINT_FINDING.UNSUPPLIED_STEP) {
			const [stepperName, stepName, input] = items;
			if (stepperName === undefined || stepName === undefined || input === undefined)
				throw new Error(`an unsupplied step's finding doesn't state its step and domain. ${DIFFERENT_BUILDS}`);
			return [LintFindingSchema.parse({ kind: kind.value, stepperName: stepperName.value, stepName: stepName.value, inputDomain: domainOf(input) })];
		}
		const [domain] = items;
		if (domain === undefined) throw new Error(`a finding ${kind?.value} doesn't state its domain. ${DIFFERENT_BUILDS}`);
		return [LintFindingSchema.parse({ kind: kind?.value, domain: domainOf(domain) })];
	});
}
