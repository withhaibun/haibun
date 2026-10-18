/**
 * The operations over the domain chain that the goal-resolution and activities steppers call: the resolution of goals, the
 * affordances and the chain's lint, each over the facts a store holds.
 */
import type { AStepper } from "../steps/domains/stepper.js";
import type { TRegisteredDomain } from "../domains/resources.js";
import type { TRecordReader } from "../records/pipelines/record-reads.js";
import { readFacts } from "../records/pipelines/facts.js";
import { buildDomainChain } from "../derivations/domain-chain.js";
import { lintDomainChain } from "../derivations/domain-chain-lint.js";
import { resolveGoal, type TGoalResolution, type TResolverInputs } from "../derivations/goal-resolver.js";
import { buildAffordances, satisfiedGoalDomains, type TAffordancesInputs } from "../derivations/affordances.js";
import { GOAL_FINDING } from "../domains/goal-resolution.js";

/** The steppers and the domains whose chain an operation reads, and the store that holds the facts. */
export type TChainScope = { steppers: AStepper[]; domains: Record<string, TRegisteredDomain>; store: TRecordReader };

/** Resolves each goal against the scope's domain chain over the facts its store holds. */
export async function resolveGoals(
	{ steppers, domains, store }: TChainScope,
	goals: readonly string[],
	inputs: Omit<TResolverInputs, "graph" | "facts">,
): Promise<TGoalResolution[]> {
	const graph = buildDomainChain(steppers, domains);
	const facts = await readFacts(store);
	return goals.map((goal) => resolveGoal(goal, { graph, facts, ...inputs }));
}

/** The affordances that the facts the scope's store holds offer a caller, and the goal domains those facts satisfy. */
export async function affordancesOf({ steppers, domains, store }: TChainScope, inputs: Omit<TAffordancesInputs, "steppers" | "domains" | "facts">) {
	const affordances = buildAffordances({ steppers, domains, facts: await readFacts(store), ...inputs });
	return { affordances, satisfied: satisfiedGoalDomains(affordances.goals, GOAL_FINDING.SATISFIED) };
}

/** The lint of the scope's domain chain, with the affordances that the chain's view draws. */
export async function chainLintOf(scope: TChainScope, held: TAffordancesInputs["held"]) {
	const { affordances } = await affordancesOf(scope, { held });
	return { ...lintDomainChain(buildDomainChain(scope.steppers, scope.domains), scope.domains), ...affordances };
}
