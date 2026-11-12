/**
 * A feature's claim over its steps' contracts, `feature {feature} entails {claim}`. Each step of the feature, and each step of a
 * statement a step states, applies its contract to individuals in the feature's order: a parameter whose term names a variable an
 * earlier step set is that step's products, and every other parameter is a fresh individual of its declared domain, which stands
 * for every value of the domain. Each step states its `requires` and its `states` of those individuals, and the relations' rules
 * derive what the chain of contracts entails. A claim holds where the rules derive it, is refuted where a contract states its
 * negation, and is unknown otherwise. An unknown claim names the first fact between its individuals that the chain doesn't derive,
 * and the step whose contract doesn't state it.
 */
import type { AStepper, TFeatureStep } from "@haibun/core/lib/steps/domains/stepper.js";
import type { TWorld } from "@haibun/core/lib/actuality/domains/world.js";
import { VERDICT, type TActionResult } from "@haibun/core/lib/domains/protocol.js";
import { DOMAIN_STATEMENT, DOMAIN_VARIABLE_NAME } from "@haibun/core/lib/domains/domains.js";
import { stepParts } from "@haibun/core/lib/steps/domains/phrase.js";
import { statementNotation, type TRelation, type TStatement } from "@haibun/core/lib/steps/domains/contract.js";
import { findFeatureStepsFromStatement } from "@haibun/core/lib/actuality/pipelines/resolver.js";
import { claimResult, entailmentOf } from "@haibun/core/lib/records/derivations/claim.js";
import { statementSentence } from "@haibun/core/lib/steps/derivations/predicate-registry.js";
import { relationPredicate, relationsQuery, statementTriple, tripleKey, type TDerive } from "../derivations/contract-terms.js";
import { patternText, quadsOf, type TN3Pattern } from "../derivations/n3.js";
import type { TReasoner } from "../ports.js";
import { declaredRelations } from "../derivations/contract-declarations.js";
import { derive } from "./reason.js";

/** The namespace of the individuals a feature's claim binds. */
const INDIVIDUAL_NAMESPACE = "urn:haibun:individual:";
/** The individual that stands for the principal of every call. */
const PRINCIPAL_INDIVIDUAL = `${INDIVIDUAL_NAMESPACE}principal`;
/** A claim as its line states it, `relation(individual, …)` with `¬` before a negation, as a contract's statement renders. */
const CLAIM_FORM = /^(¬?)([\w-]+)\((.*)\)$/s;

/** A step's application of its contract: its line, and the individuals of its parameters. */
type TApplication = { line: string; parameters: readonly string[] };

/** What a feature's steps state of their individuals: the individuals by name, the facts and the negations each contract states,
 *  each step's application by its products' individual, where the step doesn't pass on a statement's products, each fresh
 *  individual with its declared domain, and the count of steps applied. */
type TChain = {
	named: Map<string, string>;
	facts: TN3Pattern[];
	negations: TN3Pattern[];
	producedBy: Map<string, TApplication>;
	fresh: { name: string; domain: string }[];
	steps: number;
};

const individual = (name: string): string => `${INDIVIDUAL_NAMESPACE}${encodeURIComponent(name)}`;
/** The individual a derived argument is: its derivation applied to its arguments' individuals, so one derivation of the same
 *  individuals is one individual. */
const derivedIndividual: TDerive = ({ derivation }, values) => individual(`${derivation.name}(${values.join(", ")})`);

/** Applies the contract of each step of `steps` in order, and returns the individual the last step's products are. */
function apply(chain: TChain, steps: readonly TFeatureStep[], resolve: (line: string) => TFeatureStep[]): string | undefined {
	let last: string | undefined;
	for (const featureStep of steps) {
		const { step, stepValuesMap } = featureStep.action;
		const termOf = (name: string): string => {
			const value = stepValuesMap?.[name];
			if (value === undefined) throw new Error(`\`${featureStep.in}\` doesn't state {${name}}, which its step's pattern names`);
			return value.term;
		};
		const parts = stepParts(step);
		const stated = parts.flatMap(({ name, domain }) => (domain === DOMAIN_STATEMENT ? [apply(chain, resolve(termOf(name)), resolve)] : []));
		const variable = parts.find(({ domain }) => domain === DOMAIN_VARIABLE_NAME);
		const [statedProducts] = stated;
		chain.steps += 1;
		const position = chain.steps;
		const products = statedProducts === undefined ? individual(`the products of step ${position}`) : statedProducts;
		if (variable !== undefined) chain.named.set(termOf(variable.name), products);
		const parameters = Object.fromEntries(
			parts
				.filter(({ domain }) => domain !== DOMAIN_STATEMENT && domain !== DOMAIN_VARIABLE_NAME)
				.map(({ name, domain }) => {
					const term = termOf(name);
					const [base] = term.split(".");
					const bound = base === undefined ? undefined : chain.named.get(base);
					if (bound !== undefined) return [name, bound];
					const freshName = `{${name}} of step ${position}`;
					chain.fresh.push({ name: freshName, domain });
					return [name, individual(freshName)];
				}),
		);
		const contract = step.contract;
		const statements: TStatement[] = [...(contract?.requires === undefined ? [] : contract.requires), ...(contract?.states === undefined ? [] : contract.states)];
		const call = { parameters, principal: PRINCIPAL_INDIVIDUAL, products };
		for (const statement of statements) (statement.negated ? chain.negations : chain.facts).push(statementTriple(call, statement, derivedIndividual));
		if (statedProducts === undefined) chain.producedBy.set(products, { line: featureStep.in, parameters: Object.values(parameters) });
		last = products;
	}
	return last;
}

/** Returns the individuals from `from` to `to` through the parameters of the step that produced each, outside `seen`, or
 *  undefined where a path doesn't reach `to`. */
function pathOf(producedBy: ReadonlyMap<string, TApplication>, from: string, to: string, seen: ReadonlySet<string>): string[] | undefined {
	if (from === to) return [to];
	const application = producedBy.get(from);
	if (application === undefined || seen.has(from)) return undefined;
	for (const parameter of application.parameters) {
		const rest = pathOf(producedBy, parameter, to, new Set([...seen, from]));
		if (rest !== undefined) return [from, ...rest];
	}
	return undefined;
}

/** Returns the result of the claim `claim` over the contracts of the background `feature`'s steps, which the rules of the
 *  relations `steppers` declare chain. */
export async function featureClaim(world: TWorld, steppers: AStepper[], reasoner: TReasoner, feature: string, claim: string): Promise<TActionResult> {
	const relations = [...declaredRelations(steppers)];
	const resolve = (line: string) => findFeatureStepsFromStatement(line, steppers, world, undefined, [0]);
	const chain: TChain = { named: new Map(), facts: [], negations: [], producedBy: new Map(), fresh: [], steps: 0 };
	apply(chain, resolve(`Backgrounds: ${feature}`), resolve);
	const form = CLAIM_FORM.exec(claim.trim());
	const relation = form === null ? undefined : relations.find(({ name }) => name === form[2]);
	if (form === null || relation === undefined)
		throw new Error(`the claim \`${claim}\` doesn't state a relation the steppers declare as relation(individual, …). Name one of ${relations.map(({ name }) => name).join(", ")}`);
	const names = (form[3] === undefined ? "" : form[3]).split(",").map((name) => name.trim());
	const args = names.map((name) => {
		const bound = chain.named.get(name);
		if (bound === undefined) throw new Error(`the claim names ${name}, which the feature ${feature} doesn't set. Name a variable a step of the feature sets`);
		return bound;
	});
	const negated = form[1] === "¬";
	const statement: TStatement = { relation, args: names.map((name) => ({ parameter: name })), negated };
	const triple = statementTriple({ parameters: Object.fromEntries(names.map((name, at) => [name, args[at]])) }, statement, derivedIndividual);
	const rules = relations.map((held) => held.rules).join("\n");
	const sources = `${rules}\n${chain.facts.map(patternText).join("\n")}`;
	const derived = quadsOf(await derive(reasoner, sources, relationsQuery(relations), false, {}, "a feature's claim reads its steps' contracts"));
	const predicates = new Set(relations.map((held) => relationPredicate(held).value));
	const selected = new Set(derived.filter(({ predicate }) => predicates.has(predicate.value)).map(({ subject, predicate }) => tripleKey(subject, predicate, derived)));
	const holds = (fact: TN3Pattern): boolean => selected.has(tripleKey(fact.subject, fact.predicate, derived));
	const denied = chain.negations.some((negation) => patternText(negation) === patternText(triple));
	const entailment = entailmentOf({ feature, claim: statementNotation(statement), sentence: statementSentence(statement), over: chain.fresh });
	const [proves, refutes] = negated ? [denied, holds(triple)] : [holds(triple), denied];
	if (proves) return claimResult(entailment, VERDICT.proved, negated ? "a contract of its steps states it" : "the relations' rules derive it from the contracts of its steps");
	if (refutes) return claimResult(entailment, VERDICT.refuted, `${negated ? "the relations' rules derive" : "a contract of its steps states"} ${patternText(triple)}`);
	return claimResult(entailment, VERDICT.unknown, `the chain doesn't derive ${missingFact(chain, holds, relation, args)}`);
}

/** Returns the first fact of `relation` between consecutive individuals from the claim's first individual to its second, through
 *  the steps that produced them, that the chain doesn't derive, with the step whose contract doesn't state it, or the claim. */
function missingFact(chain: TChain, holds: (fact: TN3Pattern) => boolean, relation: TRelation, args: readonly string[]): string {
	const nameOf = (held: string): string => {
		const named = [...chain.named.entries()].find(([, bound]) => bound === held);
		return named === undefined ? decodeURIComponent(held.slice(INDIVIDUAL_NAMESPACE.length)) : named[0];
	};
	const [from, to] = args;
	const path = args.length === 2 && from !== undefined && to !== undefined ? pathOf(chain.producedBy, from, to, new Set()) : undefined;
	const links = path === undefined ? [] : path.slice(1).map((next, at) => [path[at], next] as const);
	for (const [a, b] of links) {
		if (a === undefined) continue;
		const fact = statementTriple({ parameters: { a, b } }, { relation, args: [{ parameter: "a" }, { parameter: "b" }], negated: false }, derivedIndividual);
		if (!holds(fact)) return `${relation.name}(${nameOf(a)}, ${nameOf(b)}), which the contract of \`${chain.producedBy.get(a)?.line}\` doesn't state`;
	}
	return `${relation.name}(${args.map(nameOf).join(", ")})`;
}
