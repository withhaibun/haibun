/**
 * Goals over producer rules as N3 backward rules, which the reasoner proves. A step the caller may call states the rule
 * fact(D) ← fact(D₁) ∧ … ∧ do(s), where s returns D and takes D₁ …. A domain holds by a fact of it, by the first producer whose
 * inputs hold, by the fields of a composite domain that steps don't return, or as an argument its caller supplies where steps
 * don't return it. The ancestors a proof passes down refuse a domain taken again below its own proof. A goal's plan is each
 * producer whose inputs hold; where it lacks both a fact and a plan, its gap is the chain of sub-goals down to the first it
 * couldn't prove.
 * The declarations a proof reads are complete, so a rule reads an absence among them through `log:collectAllIn` over its own
 * facts; a fact a proof doesn't read leaves its goal unknown.
 */
import { DataFactory } from "n3";
import type { NamedNode, Quad, Term } from "@rdfjs/types";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { LIST, LOG, RDF, XSD } from "@haibun/core/lib/domains/vocabularies.js";
import { DIFFERENT_BUILDS, type TGoalProof, type TProofNode } from "../domains/logic.js";
import { REASONER_NAMESPACE } from "../domains/reasoning.js";
import { backwardRuleText, listItems, pattern, patternText, ruleText, type TN3List, type TN3Pattern } from "./n3.js";

const { namedNode, literal, variable } = DataFactory;
const h = (name: string): NamedNode => namedNode(`${REASONER_NAMESPACE}${name}`);
/** The terms a goal's facts and rules name. */
const GOAL_TERM = {
	produced: h("Produced"),
	producers: h("producers"),
	takes: h("takes"),
	held: h("held"),
	goal: h("goal"),
	fields: h("fields"),
	name: h("name"),
	range: h("range"),
	type: h("type"),
	optional: h("optional"),
	proof: h("proof"),
	way: h("way"),
	proofs: h("proofs"),
	fieldProof: h("fieldProof"),
	fieldProofs: h("fieldProofs"),
	plan: h("plan"),
	gap: h("gap"),
	firstGap: h("firstGap"),
	unmet: h("unmet"),
	found: h("found"),
};
const T = GOAL_TERM;
/** The kind each node of a proof states first, which the node's other items follow. */
const NODE = { fact: "fact", do: "do", argument: "argument", composite: "composite", field: "field", unmet: "unmet", step: "step" } as const;
/** Why a sub-goal didn't hold: it is taken again below its own proof, or a step the caller may call doesn't return it. */
export const UNMET_WHY = { cycle: "cycle", noProducer: "no_producer" } as const;
/** The IRI of a domain and of a step, by its key and its method. */
const DOMAIN_PREFIX = `${REASONER_NAMESPACE}domain/`;
const STEP_PREFIX = `${REASONER_NAMESPACE}step/`;
export const domainIri = (key: string): NamedNode => namedNode(`${DOMAIN_PREFIX}${encodeURIComponent(key)}`);
export const stepIri = (method: string): NamedNode => namedNode(`${STEP_PREFIX}${encodeURIComponent(method)}`);

/** A list of parts, as N3 writes it in parentheses. */
const list = (...items: TN3List["list"]): TN3List => ({ list: items });
const kind = (name: string) => literal(name);
/** The absence of what `formula` states among the facts of the proof: collected in scope `scope`, the list of its instances is empty. */
const none = (scope: string, ...formula: TN3Pattern[]): TN3Pattern => pattern(list(T.found, { formula }, list()), LOG.collectAllIn, `?within${scope}`);
/** A domain `?D` without a fact of it. */
const notHeld = (scope: string) => none(scope, pattern("?D", T.held, "?held"));
/** The ancestors of a sub-goal of `?D`: `?D` before the ancestors `?A`. */
const below = pattern(list(list(variable("D")), variable("A")), LIST.append, "?A2");
const D_A = list(variable("D"), variable("A"));

/** The proof of a domain under its ancestors: the first way it holds, by a fact, a producer, a composite's fields or an argument. */
const PROOF_RULES = [
	backwardRuleText(
		[pattern(D_A, T.proof, "?P")],
		[pattern(list(variable("Q"), { formula: [pattern(D_A, T.way, "?Q")] }, variable("Qs")), LOG.collectAllIn, "?scope"), pattern("?Qs", LIST.first, "?P")],
	),
	backwardRuleText([pattern(D_A, T.way, list(kind(NODE.fact), variable("D")))], [pattern("?D", T.held, literal("true", namedNode(XSD.boolean)))]),
	backwardRuleText(
		[pattern(D_A, T.way, list(kind(NODE.do), variable("M"), variable("D"), variable("Ps")))],
		[
			notHeld("held"),
			pattern("?A", LIST.notMember, "?D"),
			pattern("?D", RDF.type, T.produced),
			pattern("?D", T.producers, "?Ms"),
			pattern("?Ms", LIST.member, "?M"),
			pattern("?M", T.takes, "?Ins"),
			below,
			pattern(list(variable("Ins"), variable("A2")), T.proofs, "?Ps"),
		],
	),
	backwardRuleText(
		[pattern(D_A, T.way, list(kind(NODE.composite), variable("D"), variable("Fs")))],
		[
			notHeld("held"),
			none("produced", pattern("?D", RDF.type, T.produced)),
			pattern("?D", T.fields, "?F"),
			below,
			pattern(list(variable("F"), variable("A2")), T.fieldProofs, "?Fs"),
		],
	),
	// A composite whose required field doesn't hold is left to its caller as an argument.
	backwardRuleText(
		[pattern(D_A, T.way, list(kind(NODE.argument), variable("D")))],
		[
			notHeld("held"),
			none("produced", pattern("?D", RDF.type, T.produced)),
			pattern("?D", T.fields, "?F"),
			below,
			none("fielded", pattern(list(variable("F"), variable("A2")), T.fieldProofs, "?any")),
		],
	),
	// A domain that steps don't return, and whose schema doesn't state fields, is supplied by its caller.
	backwardRuleText(
		[pattern(D_A, T.way, list(kind(NODE.argument), variable("D")))],
		[notHeld("held"), none("produced", pattern("?D", RDF.type, T.produced)), none("fielded", pattern("?D", T.fields, "?any"))],
	),
	backwardRuleText([pattern(list(list(), variable("A")), T.proofs, list())], []),
	backwardRuleText(
		[pattern(list(variable("Ins"), variable("A")), T.proofs, "?Ps")],
		[
			pattern("?Ins", LIST.firstRest, list(variable("I"), variable("R"))),
			pattern(list(variable("I"), variable("A")), T.proof, "?P"),
			pattern(list(variable("R"), variable("A")), T.proofs, "?Qs"),
			pattern(list(list(variable("P")), variable("Qs")), LIST.append, "?Ps"),
		],
	),
];

/** A field of a composite: one without a range is its caller's argument by its name; one with a range holds by its domain's
 *  proof. An optional field that doesn't hold is left out, and a required one leaves the composite without its fields. */
const FIELD_RULES = [
	backwardRuleText([pattern(list(list(), variable("A")), T.fieldProofs, list())], []),
	backwardRuleText(
		[pattern(list(variable("Fs"), variable("A")), T.fieldProofs, "?Out")],
		[
			pattern("?Fs", LIST.firstRest, list(variable("F"), variable("R"))),
			pattern(list(variable("F"), variable("A")), T.fieldProof, "?Node"),
			pattern(list(variable("R"), variable("A")), T.fieldProofs, "?More"),
			pattern(list(list(variable("Node")), variable("More")), LIST.append, "?Out"),
		],
	),
	backwardRuleText(
		[pattern(list(variable("Fs"), variable("A")), T.fieldProofs, "?Out")],
		[
			pattern("?Fs", LIST.firstRest, list(variable("F"), variable("R"))),
			pattern("?F", T.optional, literal("true", namedNode(XSD.boolean))),
			none("proved", pattern(list(variable("F"), variable("A")), T.fieldProof, "?any")),
			pattern(list(variable("R"), variable("A")), T.fieldProofs, "?Out"),
		],
	),
	backwardRuleText(
		[
			pattern(
				list(variable("F"), variable("A")),
				T.fieldProof,
				list(kind(NODE.field), variable("N"), literal(""), variable("Y"), variable("O"), list(kind(NODE.argument), variable("N"))),
			),
		],
		[pattern("?F", T.name, "?N"), pattern("?F", T.type, "?Y"), pattern("?F", T.optional, "?O"), none("ranged", pattern("?F", T.range, "?any"))],
	),
	backwardRuleText(
		[pattern(list(variable("F"), variable("A")), T.fieldProof, list(kind(NODE.field), variable("N"), variable("Rg"), variable("Y"), variable("O"), variable("P")))],
		[
			pattern("?F", T.name, "?N"),
			pattern("?F", T.range, "?Rg"),
			pattern("?F", T.type, "?Y"),
			pattern("?F", T.optional, "?O"),
			pattern(list(variable("Rg"), variable("A")), T.proof, "?P"),
		],
	),
];

/** A sub-goal's gap: the chain from it down to the first sub-goal its first producer couldn't prove. */
const GAP_RULES = [
	backwardRuleText([pattern(D_A, T.gap, list(list(kind(NODE.unmet), variable("D"), literal(UNMET_WHY.cycle))))], [notHeld("held"), pattern("?A", LIST.member, "?D")]),
	backwardRuleText(
		[pattern(D_A, T.gap, list(list(kind(NODE.unmet), variable("D"), literal(UNMET_WHY.noProducer))))],
		[notHeld("held"), pattern("?A", LIST.notMember, "?D"), pattern("?D", RDF.type, T.produced), pattern("?D", T.producers, list())],
	),
	backwardRuleText(
		[pattern(D_A, T.gap, "?C")],
		[
			notHeld("held"),
			pattern("?A", LIST.notMember, "?D"),
			pattern("?D", RDF.type, T.produced),
			pattern("?D", T.producers, "?Ms"),
			pattern("?Ms", LIST.first, "?M"),
			pattern("?M", T.takes, "?Ins"),
			below,
			pattern(list(variable("Ins"), variable("A2")), T.firstGap, "?R"),
			pattern(list(list(list(kind(NODE.step), variable("D"), variable("M"))), variable("R")), LIST.append, "?C"),
		],
	),
	backwardRuleText(
		[pattern(list(variable("Ins"), variable("A")), T.firstGap, "?C")],
		[
			pattern("?Ins", LIST.firstRest, list(variable("I"), variable("R"))),
			pattern(list(variable("X"), { formula: [pattern(list(variable("I"), variable("A")), T.gap, "?X")] }, variable("Xs")), LOG.collectAllIn, "?scope"),
			pattern("?Xs", LIST.first, "?C"),
		],
	),
	backwardRuleText(
		[pattern(list(variable("Ins"), variable("A")), T.firstGap, "?C")],
		[
			pattern("?Ins", LIST.firstRest, list(variable("I"), variable("R"))),
			none("gapped", pattern(list(variable("I"), variable("A")), T.gap, "?any")),
			pattern(list(variable("R"), variable("A")), T.firstGap, "?C"),
		],
	),
];

/** A goal that lacks both a fact and a plan: where the caller may not call any of its producers, the goal itself, and else its
 *  first producer's gap. */
const unplanned = [pattern("?G", T.goal, literal("true", namedNode(XSD.boolean))), none("held", pattern("?G", T.held, "?held")), none("planned", pattern("?G", T.plan, "?plan"))];
const GOAL_RULES_OF_GOALS = [
	ruleText(
		[
			pattern("?G", T.goal, literal("true", namedNode(XSD.boolean))),
			pattern("?G", T.producers, "?Ms"),
			pattern("?Ms", LIST.member, "?M"),
			pattern("?M", T.takes, "?Ins"),
			pattern(list(variable("Ins"), list(variable("G"))), T.proofs, "?Ps"),
		],
		[pattern("?G", T.plan, list(kind(NODE.do), variable("M"), variable("G"), variable("Ps")))],
	),
	ruleText([...unplanned, pattern("?G", T.producers, list())], [pattern("?G", T.unmet, list(list(kind(NODE.unmet), variable("G"), literal(UNMET_WHY.noProducer))))]),
	ruleText(
		[
			...unplanned,
			pattern("?G", T.producers, "?Ms"),
			pattern("?Ms", LIST.first, "?M"),
			pattern("?M", T.takes, "?Ins"),
			pattern(list(variable("Ins"), list(variable("G"))), T.firstGap, "?R"),
			pattern(list(list(list(kind(NODE.step), variable("G"), variable("M"))), variable("R")), LIST.append, "?C"),
		],
		[pattern("?G", T.unmet, "?C")],
	),
];

/** The rules that prove goals over producer rules. */
export const GOAL_RULES = [...PROOF_RULES, ...FIELD_RULES, ...GAP_RULES, ...GOAL_RULES_OF_GOALS].join("\n");

/** The query: each goal's fact, each of its plans, and its gap. */
export const GOAL_QUERY = [
	ruleText(
		[pattern("?G", T.goal, literal("true", namedNode(XSD.boolean))), pattern("?G", T.held, literal("true", namedNode(XSD.boolean)))],
		[pattern("?G", T.held, literal("true", namedNode(XSD.boolean)))],
	),
	ruleText([pattern("?G", T.plan, "?P")], [pattern("?G", T.plan, "?P")]),
	ruleText([pattern("?G", T.unmet, "?C")], [pattern("?G", T.unmet, "?C")]),
].join("\n");

/** A producer rule as a goal's facts state it: a step, by its method, the domain it returns and the domains it takes. */
export type TProducer = { method: string; output: string; inputs: readonly string[] };
/** A composite domain's field: its name, the domain it ranges over where it names one, its schema's type, and whether it is optional. */
export type TCompositeField = { name: string; range?: string; type: string; optional: boolean };
/** What a proof of goals reads: the steps the caller may call, each domain any step returns, each composite's fields, the domains a
 *  fact holds of, and the goals. */
export type TGoalFacts = {
	producers: readonly TProducer[];
	produced: readonly string[];
	composites: Readonly<Record<string, readonly TCompositeField[]>>;
	held: readonly string[];
	goals: readonly string[];
};

const yes = literal("true", namedNode(XSD.boolean));
const bool = (value: boolean) => literal(String(value), namedNode(XSD.boolean));

/** Returns a proof of goals' facts as N3. Each domain the steps name or a goal is states its producers the caller may call, in
 *  the steps' order, since a sub-goal holds by its first producer whose inputs hold. */
export function goalFacts({ producers, produced, composites, held, goals }: TGoalFacts): string {
	const named = [...new Set([...produced, ...goals, ...producers.flatMap(({ inputs }) => inputs)])];
	const steps = [...new Map(producers.map((one) => [one.method, one.inputs])).entries()];
	const facts: TN3Pattern[] = [
		...produced.map((domain) => pattern(domainIri(domain), RDF.type, T.produced)),
		...steps.map(([method, inputs]) => pattern(stepIri(method), T.takes, list(...inputs.map(domainIri)))),
		...named.map((domain) => pattern(domainIri(domain), T.producers, list(...producers.filter(({ output }) => output === domain).map(({ method }) => stepIri(method))))),
		...held.map((domain) => pattern(domainIri(domain), T.held, yes)),
		...goals.map((domain) => pattern(domainIri(domain), T.goal, yes)),
	];
	const fielded = Object.entries(composites).flatMap(([domain, fields]) => {
		const nodes = fields.map((_, at) => DataFactory.blankNode(`${encodeURIComponent(domain)}-${at}`));
		return [
			pattern(domainIri(domain), T.fields, list(...nodes)),
			...fields.flatMap(({ name, range, type, optional }, at) => {
				const node = itemAt(nodes, at);
				return [
					pattern(node, T.name, literal(name)),
					...(range === undefined ? [] : [pattern(node, T.range, domainIri(range))]),
					pattern(node, T.type, literal(type)),
					pattern(node, T.optional, bool(optional)),
				];
			}),
		];
	});
	return [...facts, ...fielded].map(patternText).join("\n");
}

/** Returns the key a domain's IRI or a step's IRI names. */
const keyOf = (term: Term, prefix: string): string => {
	if (term.termType !== "NamedNode" || !term.value.startsWith(prefix))
		throw new Error(`the reasoner's goals name ${term.value} where a term under ${prefix} stands. ${DIFFERENT_BUILDS}`);
	return decodeURIComponent(term.value.slice(prefix.length));
};
export const domainOf = (term: Term) => keyOf(term, DOMAIN_PREFIX);
export const stepOf = (term: Term) => keyOf(term, STEP_PREFIX);

/** Returns a node of a proof, as its list states it. */
function nodeOf(quads: readonly Quad[], node: Term): TProofNode {
	const [named, ...items] = listItems(quads, node);
	const at = (index: number): Term => {
		const item = items[index];
		if (item === undefined) throw new Error(`a node of the reasoner's goals states ${named?.value} without its item ${index}. ${DIFFERENT_BUILDS}`);
		return item;
	};
	if (named?.value === NODE.fact) return { fact: domainOf(at(0)) };
	if (named?.value === NODE.argument) return { argument: at(0).value.startsWith(DOMAIN_PREFIX) ? domainOf(at(0)) : at(0).value };
	if (named?.value === NODE.do) return { do: stepOf(at(0)), domain: domainOf(at(1)), inputs: listItems(quads, at(2)).map((input) => nodeOf(quads, input)) };
	if (named?.value === NODE.composite)
		return {
			composite: domainOf(at(0)),
			fields: listItems(quads, at(1)).map((field) => {
				const [, name, range, type, optional, proof] = listItems(quads, field);
				if (name === undefined || range === undefined || type === undefined || optional === undefined || proof === undefined)
					throw new Error(`a field of the reasoner's goals doesn't state its name, range, type, optionality and proof. ${DIFFERENT_BUILDS}`);
				return { name: name.value, domain: range.value === "" ? "" : domainOf(range), type: type.value, optional: optional.value === "true", proof: nodeOf(quads, proof) };
			}),
		};
	throw new Error(`a node of the reasoner's goals states ${named?.value}, which isn't a kind of a proof's node. ${DIFFERENT_BUILDS}`);
}

/** Returns each goal's proof, as the query's quads state it: its fact, its plans and its gap. */
export function goalProofsOf(quads: readonly Quad[], goals: readonly string[]): TGoalProof[] {
	const of = (goal: string, predicate: NamedNode) => quads.filter((one) => one.subject.equals(domainIri(goal)) && one.predicate.equals(predicate));
	return goals.map((goal) => {
		const [gap] = of(goal, T.unmet);
		const unmet =
			gap === undefined
				? []
				: listItems(quads, gap.object).map((link) => {
						const [named, domain, last] = listItems(quads, link);
						if (named === undefined || domain === undefined || last === undefined)
							throw new Error(`a gap of the reasoner's goals doesn't state its kind, domain and step. ${DIFFERENT_BUILDS}`);
						return named.value === NODE.step ? { domain: domainOf(domain), do: stepOf(last) } : { unmet: domainOf(domain), why: last.value };
					});
		return { goal, held: of(goal, T.held).length > 0, plans: of(goal, T.plan).map(({ object }) => nodeOf(quads, object)), unmet };
	});
}
