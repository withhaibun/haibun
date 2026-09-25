/**
 * Domain chain: the typed step graph.
 *
 * Pure projection over registered steppers and registered domains. Returns nodes
 * (domains), steps (rules with their declared in/out domains), and edges (one per
 * input-domain → output-domain transition labeled by step name).
 *
 * Forward dispatch and goal resolution traverse the same graph the executor builds
 * here: that is the anti-drift property of this design.
 */
import type { AStepper, TStepperStep } from "./astepper.js";
import type { TRegisteredDomain } from "./resources.js";
import { constructorName } from "./util/index.js";
import { isPrimitiveDomain, normalizeDomainKey } from "./domains.js";
import { requiredAction } from "./actions.js";
import { stepParamDomains } from "./step-registry.js";

/** Sentinel source domain for terminal producers (steps that need no inputs). */
export const SOURCE_DOMAIN = "∅";

export type TDomainChainNode = {
	key: string;
	description?: string;
	hasTopology: boolean;
};

export type TDomainChainStep = {
	stepperName: string;
	stepName: string;
	gwta?: string;
	/** The domain of each parameter its phrase names, primitives included. */
	params: Record<string, string>;
	inputDomains: string[];
	outputDomains: string[];
	capability: string;
};

export type TDomainChainEdge = {
	from: string;
	to: string;
	stepperName: string;
	stepName: string;
};

export type TDomainChainGraph = {
	domains: TDomainChainNode[];
	steps: TDomainChainStep[];
	edges: TDomainChainEdge[];
};

/**
 * Build the domain chain graph from a stepper set and a domain registry.
 * The walk is deterministic and pure: same inputs → same output.
 */
export function buildDomainChain(steppers: AStepper[], domains: Record<string, TRegisteredDomain>): TDomainChainGraph {
	const nodes: TDomainChainNode[] = Object.entries(domains).map(([key, def]) => ({
		key,
		description: def.description,
		hasTopology: !!def.topology,
	}));

	const steps: TDomainChainStep[] = [];
	const edges: TDomainChainEdge[] = [];

	for (const stepper of steppers) {
		const stepperName = constructorName(stepper);
		for (const [stepName, stepDef] of Object.entries(stepper.steps)) {
			const inputDomains = collectInputDomains(stepDef);
			const outputDomains = collectOutputDomains(stepDef);
			steps.push({
				stepperName,
				stepName,
				gwta: stepDef.gwta,
				params: Object.fromEntries(stepParamDomains(stepDef)),
				inputDomains,
				outputDomains,
				capability: requiredAction(stepperName, stepName, stepDef),
			});
			if (outputDomains.length === 0) continue;
			if (inputDomains.length === 0) {
				// Terminal producer, has no domain preconditions but still produces.
				// Represent as edges from a sentinel "∅" source so producers are
				// reachable from goal resolution's backward search.
				for (const to of outputDomains) edges.push({ from: SOURCE_DOMAIN, to, stepperName, stepName });
				continue;
			}
			for (const from of inputDomains) {
				for (const to of outputDomains) {
					edges.push({ from, to, stepperName, stepName });
				}
			}
		}
	}

	return { domains: nodes, steps, edges };
}

/** The domains a step consumes: those its phrase's parameters name, other than primitives, which a caller supplies. */
function collectInputDomains(stepDef: TStepperStep): string[] {
	return [...new Set([...stepParamDomains(stepDef).values()].filter((d) => !isPrimitiveDomain(d)))];
}

function collectOutputDomains(stepDef: TStepperStep): string[] {
	if (stepDef.productsDomain) return [normalizeDomainKey(stepDef.productsDomain)];
	if (stepDef.productsDomains) return Object.values(stepDef.productsDomains).map((d) => normalizeDomainKey(d));
	return [];
}
