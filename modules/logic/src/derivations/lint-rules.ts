/**
 * The step graph's lint as N3 rules over its declarations: a step that takes a domain that steps don't supply and its caller
 * doesn't write, a domain that steps don't take or return, and a domain a step takes that steps don't return. A domain is supplied where a step
 * returns it, or where it is persisted and a step returns an individual's address; a reference produces its target and the
 * domain from which it refers. The declarations are complete, so a finding reads an absence among them through scoped negation.
 */
import { DataFactory } from "n3";
import type { Quad } from "@rdfjs/types";
import { LOG, RDF, XSD } from "@haibun/core/lib/domains/vocabularies.js";
import { LINT_FINDING, LintFindingSchema, type TLintFinding } from "@haibun/core/lib/domains/goal-resolution.js";
import { REASONER_NAMESPACE } from "../domains/reasoning.js";
import { DIFFERENT_BUILDS } from "../domains/logic.js";
import { domainIri, domainOf, stepIri } from "./goal-rules.js";
import { listItems, pattern, patternText, ruleText, type TN3List, type TN3Pattern } from "./n3.js";

const { namedNode, literal, variable } = DataFactory;
const h = (name: string) => namedNode(`${REASONER_NAMESPACE}${name}`);
/** The terms of the step graph's facts and of what the rules derive of them. */
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
	returned: h("returned"),
	supplied: h("supplied"),
	produced: h("produced"),
	taken: h("taken"),
	named: h("named"),
	consumed: h("consumed"),
	finding: h("Finding"),
};
const L = LINT_TERM;
const yes = literal("true", namedNode(XSD.boolean));
const holds = (subject: string, predicate: (typeof L)[keyof typeof L]): TN3Pattern => pattern(subject, predicate, yes);
const lacks = (subject: string, predicate: (typeof L)[keyof typeof L]): TN3Pattern => pattern("?scope", LOG.notIncludes, { formula: [holds(subject, predicate)] });
const finding = (...items: TN3List["list"]): TN3Pattern => pattern({ list: items }, RDF.type, L.finding);

/** The rules that derive what supplies, produces, takes and consumes each domain, and the findings. */
export const LINT_RULES = [
	ruleText([pattern("?s", L.output, "?d")], [holds("?d", L.returned)]),
	ruleText([holds("?d", L.returned)], [holds("?d", L.supplied)]),
	ruleText([pattern(L.graph, L.addressDomain, "?a"), holds("?a", L.returned), holds("?d", L.persisted)], [holds("?d", L.supplied)]),
	ruleText([holds("?d", L.supplied)], [holds("?d", L.produced)]),
	ruleText([pattern("?d", L.refersTo, "?t"), holds("?t", L.supplied)], [holds("?d", L.produced)]),
	ruleText([pattern("?r", L.refersTo, "?d"), holds("?r", L.supplied)], [holds("?d", L.produced)]),
	ruleText([pattern("?s", L.input, "?d")], [holds("?d", L.taken)]),
	ruleText([pattern("?s", L.input, "?u"), pattern("?u", L.part, "?d")], [holds("?d", L.taken)]),
	ruleText([holds("?d", L.taken)], [holds("?d", L.named)]),
	ruleText([holds("?c", L.taken), pattern("?c", L.fieldRange, "?d")], [holds("?d", L.named)]),
	ruleText([holds("?d", L.named)], [holds("?d", L.consumed)]),
	ruleText([holds("?r", L.named), pattern("?r", L.refersTo, "?d")], [holds("?d", L.consumed)]),
	ruleText(
		[pattern("?s", L.input, "?d"), pattern("?s", L.stepper, "?S"), pattern("?s", L.stepName, "?N"), lacks("?d", L.produced), lacks("?d", L.written)],
		[finding(literal(LINT_FINDING.UNSUPPLIED_STEP), variable("S"), variable("N"), variable("d"))],
	),
	ruleText([holds("?d", L.node), lacks("?d", L.beyond), lacks("?d", L.consumed), lacks("?d", L.produced)], [finding(literal(LINT_FINDING.UNREACHABLE_DOMAIN), variable("d"))]),
	ruleText([holds("?d", L.node), lacks("?d", L.written), holds("?d", L.consumed), lacks("?d", L.produced)], [finding(literal(LINT_FINDING.UNPRODUCED_DOMAIN), variable("d"))]),
].join("\n");

/** The query: each finding. */
export const LINT_QUERY = ruleText([pattern("?f", RDF.type, L.finding)], [pattern("?f", RDF.type, L.finding)]);

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
