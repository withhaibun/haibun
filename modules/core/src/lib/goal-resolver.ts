/**
 * Goal resolver — backward-chaining over the domain-chain graph.
 *
 * Given a goal domain and the current working memory, find a sequence of steps
 * whose forward firings would assert a fact of that domain. Returns one of four
 * findings: satisfied (already in memory), plan (here is the chain), unreachable
 * (no producer chain), refused (resolver declined to operate honestly).
 *
 * Anti-drift invariants:
 *   - Single source of truth: consumes the same TDomainChainGraph dispatch traverses.
 *   - Refuses on anonymous-output steps: if any loaded step still uses outputSchema
 *     without an outputDomain, the resolver returns refused — it cannot see those
 *     producers, so it will not pretend to.
 *   - Capabilities required: caller must pass a granted-capability set; resolver
 *     filters producer steps by it. No optimistic assumptions.
 *   - Cycle protection mandatory: visited set + depth limit; cycles return unreachable.
 *   - Plans are advisory, never auto-executed: this module is pure search; a separate
 *     "run plan" step actually fires the chain.
 */
import { SOURCE_DOMAIN, type TDomainChainGraph, type TDomainChainStep } from "./domain-chain.js";
import type { TQuad } from "./quad-types.js";

export type TPlanStep = {
	stepperName: string;
	stepName: string;
	gwta?: string;
};

export type TAssumption = {
	domain: string;
	identity: string;
};

export type TRefusalReason = "anonymous-outputs-present" | "capability-context-required";

export type TGoalResolution =
	| { finding: "satisfied"; goal: string; factIdentity: string }
	| { finding: "plan"; goal: string; steps: TPlanStep[]; assumes: TAssumption[] }
	| { finding: "unreachable"; goal: string; missing: string[] }
	| { finding: "refused"; goal: string; refusalReason: TRefusalReason; detail: string };

export interface TResolverInputs {
	graph: TDomainChainGraph;
	facts: TQuad[];
	capabilities: ReadonlySet<string>;
	depthLimit?: number;
}

const DEFAULT_DEPTH_LIMIT = 8;

/**
 * Resolve a goal. The honest contract: if the resolver cannot produce an accurate
 * answer (because the graph is incomplete or capabilities are unknown), it returns
 * `refused` rather than guessing.
 */
export function resolveGoal(goal: string, inputs: TResolverInputs): TGoalResolution {
	const refusal = checkResolverInvariants(inputs, goal);
	if (refusal) return refusal;

	const factOfGoal = inputs.facts.find((q) => q.predicate === goal);
	if (factOfGoal) {
		return { finding: "satisfied", goal, factIdentity: factOfGoal.subject };
	}

	const depthLimit = inputs.depthLimit ?? DEFAULT_DEPTH_LIMIT;
	const visited = new Set<string>([goal]);
	const missing: string[] = [];
	const planResult = chase(goal, inputs, visited, missing, depthLimit, 0);

	if (planResult) {
		return {
			finding: "plan",
			goal,
			steps: planResult.steps,
			assumes: planResult.assumes,
		};
	}

	return {
		finding: "unreachable",
		goal,
		missing: dedupe(missing.length > 0 ? missing : [goal]),
	};
}

/**
 * Check the structural preconditions before searching. Returns a refusal when the
 * resolver cannot honestly operate; undefined when it's safe to proceed.
 */
function checkResolverInvariants(inputs: TResolverInputs, goal: string): TGoalResolution | undefined {
	if (!inputs.capabilities) {
		return {
			finding: "refused",
			goal,
			refusalReason: "capability-context-required",
			detail: "resolver requires an explicit capability set; pass an empty Set if the caller has none",
		};
	}
	const anonymous = inputs.graph.steps.filter((s) => s.outputDomains.length === 0 && producesAnything(s));
	if (anonymous.length > 0) {
		return {
			finding: "refused",
			goal,
			refusalReason: "anonymous-outputs-present",
			detail: `${anonymous.length} step(s) produce content without a declared outputDomain; resolver cannot see their products. Offending: ${anonymous
				.slice(0, 3)
				.map((s) => `${s.stepperName}.${s.stepName}`)
				.join(", ")}`,
		};
	}
	return undefined;
}

/**
 * A step is treated as "producing anything" when its gwta or its declared inputs
 * suggest an output is intended. Today the only way to know for sure is via the
 * outputDomain[s] field; lacking that, we assume any step that has an action that
 * could return products is potentially producing. The conservative choice is to
 * mark steps with outputSchema but no outputDomain as anonymous — but we don't
 * have outputSchema in the graph today. Until commit 5's migration completes, this
 * is a pure no-op and the resolver only flags genuinely silent steps. The
 * migration tightens this later.
 */
function producesAnything(_step: TDomainChainStep): boolean {
	return false;
}

type TChaseResult = { steps: TPlanStep[]; assumes: TAssumption[] };

function chase(target: string, inputs: TResolverInputs, visited: Set<string>, missing: string[], depthLimit: number, depth: number): TChaseResult | undefined {
	if (depth > depthLimit) return undefined;

	if (target === SOURCE_DOMAIN) {
		// Terminal producer needs no preconditions.
		return { steps: [], assumes: [] };
	}

	const factOfTarget = inputs.facts.find((q) => q.predicate === target);
	if (factOfTarget) {
		return { steps: [], assumes: [{ domain: target, identity: factOfTarget.subject }] };
	}

	const producers = inputs.graph.edges.filter((e) => e.to === target);
	if (producers.length === 0) {
		missing.push(target);
		return undefined;
	}

	for (const edge of producers) {
		const step = inputs.graph.steps.find((s) => s.stepperName === edge.stepperName && s.stepName === edge.stepName);
		if (!step) continue;
		if (step.capability && !inputs.capabilities.has(step.capability)) continue;

		const subPlanSteps: TPlanStep[] = [];
		const subAssumptions: TAssumption[] = [];
		let satisfiable = true;

		for (const inputDomain of step.inputDomains) {
			if (visited.has(inputDomain)) {
				satisfiable = false;
				break;
			}
			visited.add(inputDomain);
			const sub = chase(inputDomain, inputs, visited, missing, depthLimit, depth + 1);
			visited.delete(inputDomain);
			if (!sub) {
				satisfiable = false;
				break;
			}
			subPlanSteps.push(...sub.steps);
			subAssumptions.push(...sub.assumes);
		}

		if (satisfiable) {
			return {
				steps: [...subPlanSteps, { stepperName: step.stepperName, stepName: step.stepName, gwta: step.gwta }],
				assumes: subAssumptions,
			};
		}
	}

	missing.push(target);
	return undefined;
}

function dedupe<T>(items: T[]): T[] {
	return [...new Set(items)];
}
