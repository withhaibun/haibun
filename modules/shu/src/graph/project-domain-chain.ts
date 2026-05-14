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

export type TWaypointSnapshot = {
	outcome: string;
	kind: "imperative" | "declarative";
	method: string;
	resolvesDomain?: string;
	ensured: boolean;
};

/** Minimal goal-resolver path shape the projection consumes. The full TMichi
 * carries bindings (composite / fact / argument trees) too; the chain projection
 * only needs the step list to tag schema edges. */
export type TPathStepRef = { stepperName: string; stepName: string };
export type TGoalPathRef = { steps: TPathStepRef[] };

export type TAffordancesSnapshot = {
	forward: TForwardAffordance[];
	goals: Array<{ domain: string; resolution: { finding: string; michi?: TGoalPathRef[]; factIds?: string[] } }>;
	/**
	 * Per-domain field-range map carried from the server's `topology.ranges`
	 * (haibun's SHACL `sh:node` / RDFS `rdfs:range` equivalent). When present,
	 * the projection draws synthetic field nodes between each composite domain
	 * and its component domains, so the type-centric view reflects the
	 * structural relationships the resolver decomposes.
	 */
	composites?: Record<string, Record<string, string>>;
	/** Registered ActivitiesStepper waypoints — folded into the graph as nodes. */
	waypoints?: TWaypointSnapshot[];
	/**
	 * Every domain that currently has at least one asserted fact. Sourced
	 * unfiltered from working memory — distinct from `goals[]` which the
	 * affordances panel filters down to non-trivial entries. Used by the chain
	 * view to color satisfied domains even when their only producer is a
	 * single-step argument-only path.
	 */
	satisfiedDomains?: string[];
	/**
	 * Per-domain map of asserted fact identifiers. Each fact becomes a small
	 * instance node attached to its domain, so the user sees individual
	 * created vertices (e.g. each issuer) in the chain rather than just a
	 * green domain blob.
	 */
	satisfiedFacts?: Record<string, string[]>;
};

/** Id of the synthetic fact-instance node for a given factId. */
export function factNodeId(factId: string): string {
	return `fact:${factId}`;
}

/** Id of the synthetic waypoint node for an outcome. */
export function waypointNodeId(outcome: string): string {
	return `waypoint:${outcome}`;
}

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
	const goalDomains = new Set<string>();
	for (const g of a.goals) {
		goalFindings.set(g.domain, g.resolution.finding);
		goalDomains.add(g.domain);
	}
	// Working-memory truth: a domain with a fact is satisfied, regardless of whether
	// the goal-frontier kept it (trivial-filtered goals are absent from `goals[]` but
	// their producing fact may still exist).
	const satisfied = new Set(a.satisfiedDomains ?? []);
	for (const d of satisfied) goalFindings.set(d, GOAL_FINDING.SATISFIED);

	const domains = new Set<string>();
	let hasSource = false;
	for (const f of a.forward) {
		for (const d of f.inputDomains) domains.add(d);
		for (const d of f.outputDomains) domains.add(d);
		if (f.inputDomains.length === 0 && f.outputDomains.length > 0) hasSource = true;
	}
	if (hasSource) domains.add(SOURCE_DOMAIN);

	// Producer index: for each domain, the unique step (if exactly one) that produces it.
	// Used to route clicks on trivial-filtered domain nodes directly to the step-caller.
	const producersByDomain = new Map<string, TForwardAffordance>();
	const ambiguousProducer = new Set<string>();
	for (const f of a.forward) {
		for (const out of f.outputDomains) {
			if (ambiguousProducer.has(out)) continue;
			if (producersByDomain.has(out)) {
				ambiguousProducer.add(out);
				producersByDomain.delete(out);
			} else {
				producersByDomain.set(out, f);
			}
		}
	}

	const nodes: TGraphNode[] = [];
	for (const d of domains) {
		const isSource = d === SOURCE_DOMAIN;
		const node: TGraphNode = {
			id: d,
			label: isSource ? "∅ no preconditions" : d,
			kind: isSource ? "default" : findingToKind(goalFindings.get(d)),
		};
		if (!isSource) {
			node.link = { href: `?aff-goal=${encodeURIComponent(d)}` };
			const producer = producersByDomain.get(d);
			if (producer) node.invokes = { stepperName: producer.stepperName, stepName: producer.stepName };
		}
		nodes.push(node);
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
				edges.push({ from, to, label, kind: edgeKind(f), stepperName: f.stepperName, stepName: f.stepName });
			}
		}
	}

	// Composite ranges: for each declared field, emit a synthetic field node and
	// connect (component domain → field node → composite). The chain view then
	// shows the structural decomposition the resolver follows. The field node
	// deep-links to its component domain so clicking the typed slot opens the
	// affordances panel for the domain the slot accepts.
	if (a.composites) {
		for (const [composite, ranges] of Object.entries(a.composites)) {
			for (const [fieldName, fieldDomain] of Object.entries(ranges)) {
				const fieldId = fieldNodeId(composite, fieldName);
				nodes.push({ id: fieldId, label: `${fieldName} : ${fieldDomain}`, kind: "field", link: { href: `?aff-goal=${encodeURIComponent(fieldDomain)}` } });
				if (!domains.has(fieldDomain)) {
					const node: TGraphNode = { id: fieldDomain, label: fieldDomain, kind: findingToKind(goalFindings.get(fieldDomain)) };
					node.link = { href: `?aff-goal=${encodeURIComponent(fieldDomain)}` };
					const producer = producersByDomain.get(fieldDomain);
					if (producer) node.invokes = { stepperName: producer.stepperName, stepName: producer.stepName };
					nodes.push(node);
					domains.add(fieldDomain);
				}
				edges.push({ from: fieldDomain, to: fieldId, label: undefined, kind: "default" });
				edges.push({ from: fieldId, to: composite, label: fieldName, kind: "default" });
			}
		}
	}

	// Waypoint nodes: registered ActivitiesStepper outcomes. Declarative waypoints
	// link back to their resolvesDomain via a dashed edge so the chain shows that
	// the waypoint depends on the goal being satisfied.
	if (Array.isArray(a.waypoints)) {
		for (const w of a.waypoints) {
			const id = waypointNodeId(w.outcome);
			const kind = w.ensured ? "waypoint-ensured" : w.kind === "declarative" ? "waypoint-declarative" : "waypoint-imperative";
			const [stepperName, stepName] = w.method.includes("-") ? [w.method.slice(0, w.method.indexOf("-")), w.method.slice(w.method.indexOf("-") + 1)] : [w.method, w.method];
			nodes.push({
				id,
				label: `waypoint: ${w.outcome}`,
				kind,
				link: { href: `?aff-waypoint=${encodeURIComponent(w.outcome)}` },
				invokes: { stepperName, stepName },
			});
			if (w.resolvesDomain && domains.has(w.resolvesDomain)) {
				edges.push({ from: w.resolvesDomain, to: id, label: "ensures", kind: "default" });
			}
		}
	}

	// APG annotation pass — tag every schema edge with the goal-resolver paths it
	// participates in. The renderer reads `edge.paths` to style active edges
	// (any goal-path traverses them) distinctly from potential edges (a real step
	// the user could invoke, but no current goal-path runs through it). One edge
	// per step in the topology; metadata carries the path semantics.
	const edgesByStep = new Map<string, TGraphEdge[]>();
	for (const edge of edges) {
		if (!edge.stepperName || !edge.stepName) continue;
		const key = `${edge.stepperName}.${edge.stepName}`;
		const bucket = edgesByStep.get(key);
		if (bucket) bucket.push(edge);
		else edgesByStep.set(key, [edge]);
	}
	for (const goal of a.goals) {
		const michi = goal.resolution.michi ?? [];
		michi.forEach((m, pathIdx) => {
			const pid = `${goal.domain}/path-${pathIdx}`;
			for (const step of m.steps) {
				const bucket = edgesByStep.get(`${step.stepperName}.${step.stepName}`);
				if (!bucket) continue;
				for (const edge of bucket) {
					edge.paths ??= [];
					if (!edge.paths.includes(pid)) edge.paths.push(pid);
				}
			}
		});
	}

	// Fact-instance nodes: every asserted fact gets a small node attached to its
	// domain so the user sees the actual created entities (e.g. each issuer they made)
	// rather than just a coloured domain blob.
	if (a.satisfiedFacts) {
		for (const [domain, factIds] of Object.entries(a.satisfiedFacts)) {
			if (!domains.has(domain)) continue;
			for (const factId of factIds) {
				const id = factNodeId(factId);
				const label = factId.length > 24 ? `${factId.slice(0, 12)}…${factId.slice(-10)}` : factId;
				nodes.push({ id, label, kind: "fact-instance", wasGeneratedBy: { factId, domain } });
				edges.push({ from: domain, to: id, label: undefined, kind: "default" });
			}
		}
	}

	return { nodes, edges, direction: "LR" };
}
