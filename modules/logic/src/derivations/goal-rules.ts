/**
 * The facts of a proof of goals over producer rules, which `src/rules/goals.n3` proves, and each goal's proof as the query's quads
 * state it: its fact, its plans, and the gap of a goal that lacks both.
 */
import { DataFactory } from "n3";
import type { NamedNode, Quad, Term } from "@rdfjs/types";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { RDF, XSD } from "@haibun/core/lib/domains/vocabularies.js";
import { DIFFERENT_BUILDS, type TGoalProof, type TProofNode } from "../domains/logic.js";
import { REASONER_NAMESPACE } from "../domains/reasoning.js";
import { listItems, pattern, patternText, type TN3List, type TN3Pattern } from "./n3.js";

const { namedNode, literal } = DataFactory;
const h = (name: string): NamedNode => namedNode(`${REASONER_NAMESPACE}${name}`);
/** The terms of a goal's facts and of what the query selects, as `src/rules/goals.n3` names them. */
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
	plan: h("plan"),
	unmet: h("unmet"),
};
const T = GOAL_TERM;
/** The kind each node of a proof states first, which the node's other items follow, as the rules write it. */
const NODE = { fact: "fact", do: "do", argument: "argument", composite: "composite", field: "field", unmet: "unmet", step: "step" } as const;
/** Why a sub-goal didn't hold: it is taken again below its own proof, or a step the caller may call doesn't return it. */
export const UNMET_WHY = { cycle: "cycle", noProducer: "no_producer" } as const;
/** The IRI of a domain and of a step, by its key and its method. */
const DOMAIN_PREFIX = `${REASONER_NAMESPACE}domain/`;
const STEP_PREFIX = `${REASONER_NAMESPACE}step/`;
/** Each domain's IRI, made once for each key, since a proof of goals names each domain in each of its facts. */
const domainIris = new Map<string, NamedNode>();
export function domainIri(key: string): NamedNode {
	const held = domainIris.get(key);
	if (held !== undefined) return held;
	const iri = namedNode(`${DOMAIN_PREFIX}${encodeURIComponent(key)}`);
	domainIris.set(key, iri);
	return iri;
}
export const stepIri = (method: string): NamedNode => namedNode(`${STEP_PREFIX}${encodeURIComponent(method)}`);

/** A list of parts, as N3 writes it in parentheses. */
const list = (...items: TN3List["list"]): TN3List => ({ list: items });

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
