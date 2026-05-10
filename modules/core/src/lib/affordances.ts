/**
 * Affordances — "what can I do next?" projection.
 *
 * Pure function over the loaded stepper set, registered domains, current working-memory
 * fact set, and the caller's capability set. Returns:
 *   - forward: steps whose preconditions are currently satisfiable. The forward-chaining
 *     frontier. Each carries readyToFire indicating whether all input domains have at
 *     least one fact (true) or whether some inputs need to be provided as gwta args (false).
 *   - goals: for each registered domain, the resolver's verdict (satisfied | resolvable
 *     | unreachable). Resolvable carries the plan so a client can preview it.
 *
 * Affordances are the HATEOAS step layer: a client that knows nothing about the registry
 * can ask "what can I do?" and get typed, ready-to-call entries with their RPC names.
 */
import type { AStepper } from "./astepper.js";
import type { TRegisteredDomain } from "./resources.js";
import type { TQuad } from "./quad-types.js";
import { stepMethodName } from "./step-dispatch.js";
import { buildDomainChain, SOURCE_DOMAIN, type TDomainChainGraph } from "./domain-chain.js";
import { resolveGoal, type TGoalResolution } from "./goal-resolver.js";

export type TForwardAffordance = {
	/** RPC name `StepperName-stepName` — directly callable via the existing transport. */
	method: string;
	stepperName: string;
	stepName: string;
	gwta?: string;
	inputDomains: string[];
	outputDomains: string[];
	/** True when every input domain has at least one asserted fact (no gwta args needed). */
	readyToFire: boolean;
	/** Capability the caller must hold to dispatch this step; absent for ungated steps. */
	capability?: string;
};

export type TGoalAffordance = {
	domain: string;
	resolution: TGoalResolution;
};

export type TAffordances = {
	forward: TForwardAffordance[];
	goals: TGoalAffordance[];
};

export interface TAffordancesInputs {
	steppers: AStepper[];
	domains: Record<string, TRegisteredDomain>;
	facts: TQuad[];
	capabilities: ReadonlySet<string>;
}

/**
 * Build the affordances projection for the current execution state.
 */
export function buildAffordances(inputs: TAffordancesInputs): TAffordances {
	const graph = buildDomainChain(inputs.steppers, inputs.domains);
	return {
		forward: buildForwardFrontier(graph, inputs.facts, inputs.capabilities),
		goals: buildGoalFrontier(graph, inputs.facts, inputs.capabilities),
	};
}

function buildForwardFrontier(graph: TDomainChainGraph, facts: TQuad[], capabilities: ReadonlySet<string>): TForwardAffordance[] {
	const assertedDomains = new Set(facts.map((q) => q.predicate));
	const out: TForwardAffordance[] = [];
	for (const step of graph.steps) {
		if (step.capability && !capabilities.has(step.capability)) continue;
		// Skip "noise" steps with no declared inputs and no declared outputs — these are
		// typically infrastructure (Activity:, scenario:, etc.) that don't participate in
		// the typed graph; including them as affordances clutters the frontier.
		if (step.inputDomains.length === 0 && step.outputDomains.length === 0) continue;
		const readyToFire = step.inputDomains.every((d) => assertedDomains.has(d) || d === SOURCE_DOMAIN);
		out.push({
			method: stepMethodName(step.stepperName, step.stepName),
			stepperName: step.stepperName,
			stepName: step.stepName,
			gwta: step.gwta,
			inputDomains: step.inputDomains,
			outputDomains: step.outputDomains,
			readyToFire,
			capability: step.capability,
		});
	}
	return out;
}

function buildGoalFrontier(graph: TDomainChainGraph, facts: TQuad[], capabilities: ReadonlySet<string>): TGoalAffordance[] {
	const out: TGoalAffordance[] = [];
	// Consider every domain that any step declares as an output — the producible domains.
	const producibleDomains = new Set<string>();
	for (const step of graph.steps) for (const d of step.outputDomains) producibleDomains.add(d);
	for (const domain of producibleDomains) {
		const resolution = resolveGoal(domain, { graph, facts, capabilities });
		out.push({ domain, resolution });
	}
	return out;
}
