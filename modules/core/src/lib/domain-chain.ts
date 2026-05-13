/**
 * Domain chain — the typed step graph.
 *
 * Pure projection over registered steppers and registered domains. Returns nodes
 * (domains), steps (rules with their declared in/out domains), and edges (one per
 * input-domain → output-domain transition labeled by step name).
 *
 * Forward dispatch and goal resolution traverse the same graph the executor builds
 * here — that is the anti-drift property of this design.
 */
import type { AStepper, TStepperStep } from "./astepper.js";
import type { TRegisteredDomain } from "./resources.js";
import { constructorName } from "./util/index.js";
import { normalizeDomainKey } from "./domains.js";

/** Sentinel source domain for terminal producers (steps that need no inputs). */
export const SOURCE_DOMAIN = "∅";

export type TDomainChainNode = {
	key: string;
	description?: string;
	meta?: boolean;
	hasTopology: boolean;
};

export type TDomainChainStep = {
	stepperName: string;
	stepName: string;
	gwta?: string;
	inputDomains: string[];
	outputDomains: string[];
	capability?: string;
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
		meta: (def as TRegisteredDomain & { meta?: boolean }).meta === true,
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
				inputDomains,
				outputDomains,
				capability: stepDef.capability,
			});
			if (outputDomains.length === 0) continue;
			if (inputDomains.length === 0) {
				// Terminal producer — has no domain preconditions but still produces.
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

function collectInputDomains(stepDef: TStepperStep): string[] {
	if (!stepDef.inputDomains) return [];
	return Object.values(stepDef.inputDomains).map((d) => normalizeDomainKey(d));
}

function collectOutputDomains(stepDef: TStepperStep): string[] {
	if (stepDef.productsDomain) return [normalizeDomainKey(stepDef.productsDomain)];
	if (stepDef.productsDomains) return Object.values(stepDef.productsDomains).map((d) => normalizeDomainKey(d));
	// productsSchema is local-only and does NOT contribute to the resolver graph.
	return [];
}
