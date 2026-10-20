/**
 * The producer rules the registry derives from step signatures, and the step graph the lint reads. A step that returns a
 * domain D and takes the domains D₁ … states the rule fact(D) ← fact(D₁) ∧ … ∧ do(s). This derivation writes the rules a
 * caller may use and the facts that hold as the engine's terms, writes the rules and a goal as TPTP formulas, reads a goal's
 * proof back as a plan, and renders a failed proof's sub-goals as the statements that state them.
 */
import type { AStepper } from "@haibun/core/lib/steps/domains/stepper.js";
import type { TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import { isPersisted } from "@haibun/core/lib/domains/resources.js";
import type { TFact } from "@haibun/core/lib/records/domains/facts.js";
import { constructorName } from "@haibun/core/lib/domains/util.js";
import { DOMAIN_DOMAIN_KEY, domainParts, fieldRangesOf, isPrimitiveDomain, isWrittenByCaller, normalizeDomainKey, refTargetOf } from "@haibun/core/lib/domains/domains.js";
import { mayCall, requiredAction } from "@haibun/core/lib/domains/actions.js";
import { stepParamDomains } from "@haibun/core/lib/steps/derivations/step-tools.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { unwrap, unwrapToShape } from "@haibun/core/lib/domains/zod-unwrap.js";
import { DOMAIN_INDIVIDUAL_ADDRESS } from "@haibun/core/lib/domains/typed-links.js";
import type { TBinding, TCompositeRanges, TFieldBinding, TForwardAffordance, TPlan } from "@haibun/core/lib/domains/goal-resolution.js";
import { FACT_FIELD } from "@haibun/core/lib/records/domains/facts.js";
import type { TGoalProof, TProofNode } from "../domains/logic.js";
import { atom, list } from "./terms.js";
import { literalTerm, renderStepLine } from "@haibun/core/lib/steps/derivations/named-vars.js";
import { RESOLVE_STATEMENT } from "../domains/logic.js";
import { conjunction, literalOf, nameOfText, variableAt, type TFormula, type TTerm } from "./formula.js";
import type { TStatedFormula } from "./term-graph.js";

type TDomains = Record<string, TRegisteredDomain>;

/** A step's signature: its method, the domains it takes other than primitives, the domains it returns, and the action it requires. */
export type TStepSignature = Omit<TForwardAffordance, "readyToRun">;

export function stepSignatures(steppers: readonly AStepper[]): TStepSignature[] {
	return steppers.flatMap((stepper) => {
		const stepperName = constructorName(stepper);
		return Object.entries(stepper.steps).map(([stepName, step]) => {
			const params = stepParamDomains(step);
			const outputs = step.productsDomain !== undefined ? [step.productsDomain] : step.productsDomains === undefined ? [] : Object.values(step.productsDomains);
			return {
				method: stepMethodName(stepperName, stepName),
				stepperName,
				stepName,
				...(step.gwta === undefined ? {} : { gwta: step.gwta }),
				inputDomains: [...new Set([...params.values()].filter((domain) => !isPrimitiveDomain(domain)))],
				outputDomains: outputs.map(normalizeDomainKey),
				capability: requiredAction(stepperName, stepName, step),
			};
		});
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

/** The rules a caller holding `held` may use, with the first fact of each domain that holds, as the engine's term. A proof
 *  cites only a domain's first fact, so the term's size follows the domains, not the facts. */
export function producerRules(signatures: readonly TStepSignature[], domains: TDomains, facts: readonly TFact[], held: string | string[] | undefined): string {
	const producers = signatures
		.filter((one) => mayCall(held, one))
		.flatMap((one) => one.outputDomains.map((out) => `p(${atom(one.method)}, ${atom(out)}, ${list(one.inputDomains.map(atom))})`));
	const produced = [...new Set(signatures.flatMap((one) => one.outputDomains))].map(atom);
	const composites = Object.keys(domains).flatMap((key) => {
		const fields = compositeFields(domains[key], domains);
		return fields.length === 0 ? [] : [`c(${atom(key)}, ${list(fields)})`];
	});
	return `r(${[list(producers), list(produced), list(composites), list([...new Map(facts.toReversed().map((fact) => [fact.domain, fact.id]))].map(([domain, id]) => `f(${atom(domain)}, ${atom(id)})`))].join(", ")})`;
}

/** A fact of a domain as TPTP states it: the property by which a fact's record states its domain, over the fact and the domain
 *  as the record's text holds it, so a rule reads the facts a graph's axioms state. */
const factOf = (fact: TTerm, domain: string): TFormula => ({ atom: FACT_FIELD.domain, args: [fact, literalOf(domain)] });

/**
 * The producer rules a caller holding `held` may use that take or return a domain of `domains`, as TPTP axioms: the product of a
 * step called with facts of the domains it takes is a fact of the domain it returns, named by the step's method over those
 * facts, so a prover's proof of a goal names the steps a plan calls. Each states the step's pattern, the statement that calls it.
 */
export function producerAxioms(signatures: readonly TStepSignature[], held: string | string[] | undefined, domains: ReadonlySet<string>): TStatedFormula[] {
	const applying = signatures.filter((one) => mayCall(held, one) && [...one.inputDomains, ...one.outputDomains].some((domain) => domains.has(domain)));
	const formulas = applying.flatMap((one) =>
		one.outputDomains.map((output): { formula: TFormula; statement: string } => {
			const variables = one.inputDomains.map((_, at) => variableAt(at));
			const product = factOf({ functor: nameOfText(one.method), args: variables.map((variable) => ({ variable })) }, output);
			const statement = one.gwta === undefined ? one.method : one.gwta;
			if (variables.length === 0) return { formula: product, statement };
			const body = conjunction(one.inputDomains.map((domain, at) => factOf({ variable: variableAt(at) }, domain)));
			return { formula: { quantifier: "!", variables, body: { connective: "=>", left: body, right: product } }, statement };
		}),
	);
	return formulas.map((stated, at) => ({ name: `r${at + 1}`, role: "axiom", ...stated }));
}

/** A goal as a TPTP conjecture, which its resolve statement states: a fact of its domain exists. */
export const goalConjecture = (goal: string): TStatedFormula => ({
	name: "goal",
	role: "conjecture",
	formula: { quantifier: "?", variables: [variableAt(0)], body: factOf({ variable: variableAt(0) }, goal) },
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
export function forwardOf(signatures: readonly TStepSignature[], facts: readonly TFact[], held: string | string[] | undefined): TForwardAffordance[] {
	const asserted = new Set(facts.map((fact) => fact.domain));
	const produced = new Set(signatures.flatMap((one) => one.outputDomains));
	return signatures
		.filter((one) => mayCall(held, one) && one.inputDomains.length + one.outputDomains.length > 0)
		.map((one) => ({ ...one, readyToRun: one.inputDomains.every((domain) => asserted.has(domain) || !produced.has(domain)) }));
}

type TFlat = { steps: TPlan["steps"]; bindings: TBinding[] };

/** A proof that holds as a plan: the steps it leaves to call, in the order their products are taken, and how each input holds. */
export function planOf(proof: TProofNode, byMethod: ReadonlyMap<string, TStepSignature>): TPlan {
	const flat = (node: TProofNode): TFlat => {
		if ("fact" in node) return { steps: [], bindings: [{ kind: "fact", domain: node.domain, factId: node.fact }] };
		if ("argument" in node) return { steps: [], bindings: [{ kind: "argument", domain: node.argument }] };
		if ("unmet" in node) throw new Error(`a plan holds the unmet goal ${node.unmet}; the engine returns a plan only where each sub-goal holds`);
		if ("composite" in node) {
			const fields = node.fields.map((field) => ({ field, sub: flat(field.proof) }));
			const bound = fields.map(({ field, sub }): TFieldBinding => {
				const base = { fieldName: field.name, fieldDomain: field.domain, fieldType: field.type, optional: field.optional };
				const leaf = sub.bindings[0];
				if (leaf?.kind === "fact") return { ...base, kind: "fact", factId: leaf.factId };
				return leaf?.kind === "composite" ? { ...base, kind: "composite", fields: leaf.fields } : { ...base, kind: "argument" };
			});
			return { steps: fields.flatMap(({ sub }) => sub.steps), bindings: [{ kind: "composite", domain: node.composite, fields: bound }] };
		}
		const step = byMethod.get(node.do);
		if (step === undefined) throw new Error(`the engine's plan calls ${node.do}, which the step signatures don't hold`);
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
	if (last === undefined || !("why" in last)) throw new Error(`the engine refuted the goal ${proof.goal} without the sub-goal it couldn't prove`);
	const { unmet: domain, why } = last;
	if (why === "no_producer") return `a step the caller may call doesn't return ${domain}; declare a step that returns it, or request the action of a step that does`;
	if (why === "cycle") return `${domain} is taken again below its own proof; state a step that returns it from other domains`;
	return `the proof of ${domain} reached the engine's bound ${why}; state a step that returns it from fewer steps`;
}
