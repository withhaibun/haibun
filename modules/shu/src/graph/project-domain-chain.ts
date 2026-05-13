/**
 * Pure projection from the goal-resolver's affordances snapshot into the
 * renderer-agnostic `TGraph` shape consumed by `shu-graph`.
 *
 * The chain view is the type-centric variant: domains are nodes, steps are
 * labeled edges. Steps without inputs originate from a sentinel "no
 * preconditions" source node so they remain visible in the graph.
 *
 * Goal findings drive node `kind` via the built-in vocabulary:
 *   - satisfied  →  the resolver found a fact for the domain
 *   - reachable  →  a michi path reaches the domain (UI label for `michi`)
 *   - unreachable / refused  →  the resolver's negative findings
 *
 * Step readiness drives edge `kind`:
 *   - ready      →  inputs satisfied; bold arrow
 *   - blocked    →  inputs not yet satisfied; dashed arrow
 *   - capability-gated  →  step requires an unmet capability
 */
import { GOAL_FINDING } from "@haibun/core/lib/goal-resolver.js";
import type { TGraph, TGraphEdge, TGraphNode } from "./types.js";

export type TForwardAffordance = {
	stepperName: string;
	stepName: string;
	gwta?: string;
	inputDomains: string[];
	outputDomains: string[];
	readyToRun: boolean;
	capability?: string;
};

export type TAffordancesSnapshot = {
	forward: TForwardAffordance[];
	goals: Array<{ domain: string; resolution: { finding: string } }>;
	/**
	 * Per-domain field-range map carried from the server's `topology.ranges`
	 * (haibun's SHACL `sh:node` / RDFS `rdfs:range` equivalent). When present,
	 * the projection draws synthetic field nodes between each composite domain
	 * and its component domains, so the type-centric view reflects the
	 * structural relationships the resolver decomposes.
	 */
	composites?: Record<string, Record<string, string>>;
};

/**
 * Id used for the sentinel "no-preconditions" source node.
 *
 * Mermaid's renderer sanitises any non-alphanumeric character to `_`. Routing
 * every input-less step through a `_`-id node tends to collide with Mermaid's
 * own internal helper identifiers on large graphs and the parser intermittently
 * fails to render. A clearly-namespaced id avoids the collision while the
 * visible label still reads `∅ (no preconditions)`.
 */
export const SOURCE_DOMAIN = "__no_inputs__";

function findingToKind(finding: string | undefined): string {
	if (finding === GOAL_FINDING.SATISFIED) return "satisfied";
	if (finding === GOAL_FINDING.MICHI) return "reachable";
	if (finding === GOAL_FINDING.UNREACHABLE) return "unreachable";
	if (finding === GOAL_FINDING.REFUSED) return "refused";
	return "default";
}

function edgeKind(f: TForwardAffordance): string {
	if (f.capability) return "capability-gated";
	return f.readyToRun ? "ready" : "blocked";
}

/** Id of the synthetic field node for `${domain}.${fieldName}`. */
function fieldNodeId(domain: string, fieldName: string): string {
	return `${domain}#${fieldName}`;
}

export function projectDomainChain(a: TAffordancesSnapshot): TGraph {
	const goalFindings = new Map<string, string>();
	for (const g of a.goals) goalFindings.set(g.domain, g.resolution.finding);

	const domains = new Set<string>();
	let hasSource = false;
	for (const f of a.forward) {
		for (const d of f.inputDomains) domains.add(d);
		for (const d of f.outputDomains) domains.add(d);
		if (f.inputDomains.length === 0 && f.outputDomains.length > 0) hasSource = true;
	}
	if (hasSource) domains.add(SOURCE_DOMAIN);

	const nodes: TGraphNode[] = [];
	for (const d of domains) {
		const isSource = d === SOURCE_DOMAIN;
		nodes.push({
			id: d,
			label: isSource ? "∅ no preconditions" : d,
			kind: isSource ? "default" : findingToKind(goalFindings.get(d)),
		});
	}

	const edges: TGraphEdge[] = [];
	// Dedup edges by (from, to, stepperName, stepName): a step with multiple
	// inputs of the same domain (e.g. `verify credential {id: string} as {verifierId: string}`)
	// would otherwise contribute N identical from→to edges, one per input position.
	const edgeKeys = new Set<string>();
	for (const f of a.forward) {
		const label = (f.gwta ?? `${f.stepperName}.${f.stepName}`) + (f.capability ? " ⚷" : "");
		const ins = f.inputDomains.length === 0 ? [SOURCE_DOMAIN] : f.inputDomains;
		for (const from of ins) {
			for (const to of f.outputDomains) {
				const key = `${from}${to}${f.stepperName}.${f.stepName}`;
				if (edgeKeys.has(key)) continue;
				edgeKeys.add(key);
				edges.push({ from, to, label, kind: edgeKind(f) });
			}
		}
	}

	// Composite ranges: for each declared field, emit a synthetic field node and
	// connect (component domain → field node → composite). The chain view then
	// shows the structural decomposition the resolver follows.
	if (a.composites) {
		for (const [composite, ranges] of Object.entries(a.composites)) {
			for (const [fieldName, fieldDomain] of Object.entries(ranges)) {
				const fieldId = fieldNodeId(composite, fieldName);
				nodes.push({ id: fieldId, label: `${fieldName} : ${fieldDomain}`, kind: "field" });
				if (!domains.has(fieldDomain)) {
					nodes.push({ id: fieldDomain, label: fieldDomain, kind: findingToKind(goalFindings.get(fieldDomain)) });
					domains.add(fieldDomain);
				}
				edges.push({ from: fieldDomain, to: fieldId, label: undefined, kind: "default" });
				edges.push({ from: fieldId, to: composite, label: fieldName, kind: "default" });
			}
		}
	}

	return { nodes, edges, direction: "LR" };
}
