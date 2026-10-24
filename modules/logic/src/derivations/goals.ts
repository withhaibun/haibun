/**
 * The producer rules the registry derives from step signatures, and the step graph the lint reads. A step that returns a
 * domain D and takes the domains D₁ … states the rule fact(D) ← fact(D₁) ∧ … ∧ do(s). This derivation writes the rules a
 * caller may use and the read of the domains a fact holds of as the engine's terms, writes the rules and a goal as TPTP formulas,
 * reads a goal's proof back as a plan, and renders a failed proof's sub-goals as the statements that state them.
 */
import type { AStepper } from "@haibun/core/lib/steps/domains/stepper.js";
import type { TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import { FACT_LABEL, isPersisted } from "@haibun/core/lib/domains/resources.js";
import { FACT_FIELD, type TFact } from "@haibun/core/lib/records/domains/facts.js";
import type { TQuadPattern } from "@haibun/core/lib/steps/domains/quad-types.js";
import { valueAt } from "@haibun/core/lib/domains/item-at.js";
import {
	DOMAIN_DOMAIN_KEY,
	DomainKeySchema,
	domainParts,
	fieldRangesOf,
	isPrimitiveDomain,
	isWrittenByCaller,
	normalizeDomainKey,
	refTargetOf,
} from "@haibun/core/lib/domains/domains.js";
import { mayCall, requiredAction } from "@haibun/core/lib/domains/actions.js";
import { declaredSteps, registeredPredicate } from "@haibun/core/lib/steps/derivations/predicate-registry.js";
import { stepParts } from "@haibun/core/lib/steps/domains/phrase.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { unwrap, unwrapToShape } from "@haibun/core/lib/domains/zod-unwrap.js";
import { DOMAIN_INDIVIDUAL_ADDRESS } from "@haibun/core/lib/domains/typed-links.js";
import { FieldDomainSchema, type TBinding, type TCompositeRanges, type TFieldBinding, type TForwardAffordance, type TPlan } from "@haibun/core/lib/domains/goal-resolution.js";
import { DIFFERENT_BUILDS, type TGoalProof, type TProofNode } from "../domains/logic.js";
import { atom, list } from "./terms.js";
import { literalTerm, renderStepLine } from "@haibun/core/lib/steps/derivations/named-vars.js";
import { RESOLVE_STATEMENT } from "../domains/logic.js";
import { conjunction, literalOf, nameOfText, variableAt, type TFormula, type TTerm } from "./formula.js";
import type { TStatedFormula } from "./term-graph.js";

type TDomains = Record<string, TRegisteredDomain>;
/** A fact as a goal's proof reads it: its id and its domain. */
export type THeldFact = Pick<TFact, "id" | "domain">;
/** The read of each fact's domain, which a fact's record states by its property `domain`. */
export const FACTS_HELD = { predicate: FACT_FIELD.domain, namedGraph: FACT_LABEL } satisfies TQuadPattern;

/** A step's signature: its method, the domains it takes other than primitives, the domains it returns, and the action it requires. */
export type TStepSignature = Omit<TForwardAffordance, "readyToRun">;

export function stepSignatures(steppers: readonly AStepper[]): TStepSignature[] {
	return declaredSteps(steppers).map(({ stepperName, actionName: stepName, step }) => {
		const outputs = step.productsDomain !== undefined ? [step.productsDomain] : step.productsDomains === undefined ? [] : Object.values(step.productsDomains);
		return {
			method: stepMethodName(stepperName, stepName),
			stepperName,
			stepName,
			...(step.gwta === undefined ? {} : { gwta: step.gwta }),
			inputDomains: [...new Set(stepParts(step).flatMap(({ domain }) => (isPrimitiveDomain(domain) ? [] : [DomainKeySchema.parse(domain)])))],
			outputDomains: outputs.map((key) => DomainKeySchema.parse(normalizeDomainKey(key))),
			capability: requiredAction(stepperName, stepName, step),
		};
	});
}

/** The fields of a domain whose schema is an object, each with the domain `topology.ranges` names for it. */
function compositeFields(domain: TRegisteredDomain | undefined, domains: TDomains): string[] {
	const shape = domain === undefined ? null : unwrapToShape(domain.schema);
	if (domain === undefined || shape === null) return [];
	const ranges = domain.topology?.ranges;
	return Object.entries(shape).map(([name, type]) => {
		const { inner, optional } = unwrap(type);
		const range = ranges?.[name];
		return `f(${[atom(name), atom(range !== undefined && domains[range] !== undefined ? range : ""), atom(inner._zod.def.type), String(optional)].join(", ")})`;
	});
}

/** The rules a caller holding `held` may use, with the read of the domains a fact holds of, as the engine's term. A proof reads
 *  the facts once, so the term's size follows the domains, not the facts. */
export function producerRules(signatures: readonly TStepSignature[], domains: TDomains, held: string | string[] | undefined): string {
	const producers = signatures
		.filter((one) => mayCall(held, one))
		.flatMap((one) => one.outputDomains.map((out) => `p(${atom(one.method)}, ${atom(out)}, ${list(one.inputDomains.map(atom))})`));
	const produced = [...new Set(signatures.flatMap((one) => one.outputDomains))].map(atom);
	const composites = Object.keys(domains).flatMap((key) => {
		const fields = compositeFields(domains[key], domains);
		return fields.length === 0 ? [] : [`c(${atom(key)}, ${list(fields)})`];
	});
	return `r(${[list(producers), list(produced), list(composites), `q(_, ${atom(FACTS_HELD.predicate)}, _, ${atom(FACTS_HELD.namedGraph)})`].join(", ")})`;
}

/** The registry's predicates by name, with their arity. */
type TArities = ReadonlyMap<string, number>;

/** A fact of a domain as TPTP states it: the property by which a fact's record states its domain, as the registry's `arities`
 *  hold it, over the fact and the domain as the record's text holds it, so a rule reads the facts a graph's axioms state. */
const factOf = (arities: TArities, fact: TTerm, domain: string): TFormula => ({ atom: registeredPredicate(arities, FACT_FIELD.domain, 2), args: [fact, literalOf(domain)] });

/**
 * The producer rules a caller holding `held` may use that take or return a domain of `domains`, as TPTP axioms: the product of a
 * step called with facts of the domains it takes is a fact of the domain it returns, named by the step's method over those
 * facts, so a prover's proof of a goal names the steps a plan calls. Each states the step's pattern, the statement that calls it.
 */
export function producerAxioms(signatures: readonly TStepSignature[], held: string | string[] | undefined, domains: ReadonlySet<string>, arities: TArities): TStatedFormula[] {
	const applying = signatures.filter((one) => mayCall(held, one) && [...one.inputDomains, ...one.outputDomains].some((domain) => domains.has(domain)));
	const formulas = applying.flatMap((one) =>
		one.outputDomains.map((output): { formula: TFormula; statement: string } => {
			const variables = one.inputDomains.map((_, at) => variableAt(at));
			const product = factOf(arities, { functor: nameOfText(one.method), args: variables.map((variable) => ({ variable })) }, output);
			const statement = one.gwta === undefined ? one.method : one.gwta;
			if (variables.length === 0) return { formula: product, statement };
			const body = conjunction(one.inputDomains.map((domain, at) => factOf(arities, { variable: variableAt(at) }, domain)));
			return { formula: { quantifier: "!", variables, body: { connective: "=>", left: body, right: product } }, statement };
		}),
	);
	return formulas.map((stated, at) => ({ name: `r${at + 1}`, role: "axiom", ...stated }));
}

/** A goal as a TPTP conjecture, which its resolve statement states: a fact of its domain exists. */
export const goalConjecture = (goal: string, arities: TArities): TStatedFormula => ({
	name: "goal",
	role: "conjecture",
	formula: { quantifier: "?", variables: [variableAt(0)], body: factOf(arities, { variable: variableAt(0) }, goal) },
	statement: renderStepLine(RESOLVE_STATEMENT, { goal: literalTerm(goal, DOMAIN_DOMAIN_KEY) }),
});

/** The step graph the lint reads, as the engine's term. */
export function stepGraph(signatures: readonly TStepSignature[], domains: TDomains): string {
	const steps = signatures.map((one) => `s(${[atom(one.stepperName), atom(one.stepName), list(one.inputDomains.map(atom)), list(one.outputDomains.map(atom))].join(", ")})`);
	const keys = [...new Set([...Object.keys(domains), ...signatures.flatMap((one) => one.inputDomains)])];
	const described = keys.map((key) => {
		const domain = domains[key];
		const node = domain !== undefined && !isPrimitiveDomain(key);
		const beyond = domain !== undefined && (isPersisted(domain.topology) || typeof domain.ui?.component === "string");
		return `d(${[atom(key), node, isWrittenByCaller(key, domains), beyond, domain !== undefined && isPersisted(domain.topology)].join(", ")})`;
	});
	const refs = Object.entries(domains).flatMap(([key, domain]) => {
		const target = refTargetOf(domain, domains);
		return target === undefined ? [] : [`ref(${atom(key)}, ${atom(target)})`];
	});
	const parts = keys.flatMap((key) => (domainParts(key).length > 1 ? domainParts(key).map((part) => `part(${atom(key)}, ${atom(part)})`) : []));
	const ranges = Object.entries(domains).flatMap(([key, domain]) => fieldRangesOf(domain, domains).map((range) => `range(${atom(key)}, ${atom(range)})`));
	return `g(${[list(steps), list(described), list(refs), list(parts), list(ranges), atom(DOMAIN_INDIVIDUAL_ADDRESS)].join(", ")})`;
}

/** Each composite domain's fields by the domain each ranges over. A reference names a record of its target, so it is left out. */
export const compositeRanges = (domains: TDomains): TCompositeRanges =>
	Object.fromEntries(
		Object.entries(domains).flatMap(([key, domain]) =>
			refTargetOf(domain, domains) === undefined && domain.topology?.ranges !== undefined ? [[key, { ...domain.topology.ranges }]] : [],
		),
	);

/** The steps on offer: each step the caller may call that takes or returns a domain, ready where each domain it takes holds,
 *  is written by its caller, or isn't returned by a step. */
export function forwardOf(signatures: readonly TStepSignature[], facts: readonly THeldFact[], held: string | string[] | undefined): TForwardAffordance[] {
	const asserted = new Set(facts.map((fact) => fact.domain));
	const produced = new Set(signatures.flatMap((one) => one.outputDomains));
	return signatures
		.filter((one) => mayCall(held, one) && one.inputDomains.length + one.outputDomains.length > 0)
		.map((one) => ({ ...one, readyToRun: one.inputDomains.every((domain) => asserted.has(domain) || !produced.has(domain)) }));
}

type TFlat = { steps: TPlan["steps"]; bindings: TBinding[] };

/** A proof that holds as a plan: the steps it leaves to call, in the order their products are taken, and how each input holds,
 *  a domain a fact holds of by the latest fact of that domain. */
export function planOf(proof: TProofNode, byMethod: ReadonlyMap<string, TStepSignature>, latest: ReadonlyMap<string, string>): TPlan {
	const flat = (node: TProofNode): TFlat => {
		if ("fact" in node)
			return {
				steps: [],
				bindings: [{ kind: "fact", domain: DomainKeySchema.parse(node.fact), factId: valueAt(latest, node.fact, "the latest fact of a domain the engine read") }],
			};
		if ("argument" in node) return { steps: [], bindings: [{ kind: "argument", domain: DomainKeySchema.parse(node.argument) }] };
		if ("unmet" in node) throw new Error(`A plan the step program returned holds the unmet goal ${node.unmet}. ${DIFFERENT_BUILDS}`);
		if ("composite" in node) {
			const fields = node.fields.map((field) => ({ field, sub: flat(field.proof) }));
			const bound = fields.map(({ field, sub }): TFieldBinding => {
				const base = { fieldName: field.name, fieldDomain: FieldDomainSchema.parse(field.domain), fieldType: field.type, optional: field.optional };
				const leaf = sub.bindings[0];
				if (leaf?.kind === "fact") return { ...base, kind: "fact", factId: leaf.factId };
				return leaf?.kind === "composite" ? { ...base, kind: "composite", fields: leaf.fields } : { ...base, kind: "argument" };
			});
			return { steps: fields.flatMap(({ sub }) => sub.steps), bindings: [{ kind: "composite", domain: DomainKeySchema.parse(node.composite), fields: bound }] };
		}
		const step = byMethod.get(node.do);
		if (step === undefined) throw new Error(`A plan the step program returned calls ${node.do}, which this process doesn't declare. ${DIFFERENT_BUILDS}`);
		const subs = node.inputs.map(flat);
		const called = { stepperName: step.stepperName, stepName: step.stepName, ...(step.gwta === undefined ? {} : { gwta: step.gwta }), productsDomain: node.domain };
		return { steps: [...subs.flatMap((sub) => sub.steps), called], bindings: subs.flatMap((sub) => sub.bindings) };
	};
	return flat(proof);
}

/** A goal proved alone returns its plans and its facts; a goal whose every plan is one step that takes only arguments repeats a
 *  step on offer. */
export const isTrivial = (plans: readonly TPlan[]): boolean =>
	plans.every(
		(plan) =>
			plan.steps.length <= 1 &&
			plan.bindings.every((binding) => binding.kind === "argument" || (binding.kind === "composite" && binding.fields.every((field) => field.kind === "argument"))),
	);

/** The domains a plan's steps take from a caller, including those a composite's fields take. */
export function argumentsOf(plan: TPlan): string[] {
	const fieldArguments = (fields: TFieldBinding[]): string[] =>
		fields.flatMap((field) => (field.kind === "argument" ? [field.fieldName] : field.kind === "composite" ? fieldArguments(field.fields) : []));
	return plan.bindings.flatMap((binding) => (binding.kind === "argument" ? [binding.domain] : binding.kind === "composite" ? fieldArguments(binding.fields) : []));
}

/** Why a goal's proof failed: the sub-goal it couldn't prove, why the engine couldn't prove it, and what proves it. */
export function unmetReason(proof: TGoalProof): string {
	const last = proof.unmet.at(-1);
	if (last === undefined || !("why" in last)) throw new Error(`The step program refuted the goal ${proof.goal} without the goal it couldn't prove. ${DIFFERENT_BUILDS}`);
	const { unmet: domain, why } = last;
	if (why === "no_producer") return `a step the caller may call doesn't return ${domain}. Declare a step that returns it, or request the action of a step that does.`;
	if (why === "cycle") return `${domain} is taken again below its own proof. State a step that returns it from other domains.`;
	const depth = /^depth\((\d+)\)$/.exec(why)?.[1];
	if (depth === undefined) throw new Error(`The step program refuted the goal ${proof.goal} for a reason the TypeScript prover doesn't read. ${DIFFERENT_BUILDS}`);
	return `the proof of ${domain} went past ${depth} steps, the bound of a proof. State a step that returns it from fewer steps.`;
}
