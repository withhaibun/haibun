/**
 * Affordances — "what can I do next?" projection.
 *
 * Pure function over the loaded stepper set, registered domains, current working-memory
 * fact set, and the caller's capability set. Returns:
 *   - forward: steps whose preconditions are currently satisfiable. The forward-chaining
 *     frontier. Each carries readyToRun indicating whether all input domains have at
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
import { BASE_TYPES, DOMAIN_DOMAIN_KEY } from "./domains.js";
import { resolveGoal, GOAL_FINDING, type TGoalResolution } from "./goal-resolver.js";
import { compareSeqPath, parseSeqPath } from "./seq-path.js";

/** Primitive domains: their values come from step arguments, not from facts. */
export const PRIMITIVE_DOMAINS: ReadonlySet<string> = new Set<string>([...BASE_TYPES, DOMAIN_DOMAIN_KEY]);

/**
 * Does this domain's value come from a step argument? True when the domain is a
 * primitive, or when no registered step produces it (no fact source exists, so the
 * value must be passed in as an argument).
 */
export function isArgumentDomain(domain: string, forward: ReadonlyArray<{ outputDomains: string[] }>): boolean {
	if (PRIMITIVE_DOMAINS.has(domain)) return true;
	return !forward.some((f) => f.outputDomains.includes(domain));
}

export type TForwardAffordance = {
	/** RPC name `StepperName-stepName` — directly callable via the existing transport. */
	method: string;
	stepperName: string;
	stepName: string;
	gwta?: string;
	inputDomains: string[];
	outputDomains: string[];
	/** True when every input domain has at least one asserted fact (no gwta args needed). */
	readyToRun: boolean;
	/** Capability the caller must hold to dispatch this step; absent for ungated steps. */
	capability?: string;
};

export type TGoalAffordance = {
	domain: string;
	description: string;
	resolution: TGoalResolution;
};

export const WAYPOINT_KIND = { IMPERATIVE: "imperative", DECLARATIVE: "declarative" } as const;
export type TWaypointKind = (typeof WAYPOINT_KIND)[keyof typeof WAYPOINT_KIND];

export type TWaypointEntry = {
	outcome: string;
	kind: TWaypointKind;
	method: string;
	paramSlots: string[];
	proofStatements: string[];
	resolvesDomain?: string;
	/** True when this waypoint has been ensured: either `ensure` ran its proof to success, or its declarative goal currently has a satisfying fact. */
	ensured: boolean;
	error?: string;
	source: { path: string; lineNumber?: number };
	isBackground: boolean;
};

/**
 * Per-domain composite-field map. Each entry names the registered field-domain
 * for one schema field, sourced from `topology.ranges`. Empty for atomic domains.
 * Consumed by the chain view to emit synthetic field nodes between a composite
 * and its component domains.
 */
export type TCompositeRanges = Record<string, Record<string, string>>;

export type TAffordances = {
	forward: TForwardAffordance[];
	goals: TGoalAffordance[];
	composites?: TCompositeRanges;
	/**
	 * Every domain that currently has at least one asserted fact in working memory.
	 * Distinct from `goals[].resolution.finding === satisfied` — that list is filtered
	 * to drop trivial single-step goals, whereas this set captures all asserted
	 * domains (including ones produced by argument-only single-step paths). Used by
	 * the chain view to color every node by actual state rather than the
	 * affordance-panel-shaped goals projection.
	 */
	satisfiedDomains: string[];
	/**
	 * Per-domain map of asserted fact identifiers (the producing seqPath, in string
	 * form). The chain view uses this to render individual fact-instance nodes
	 * attached to their domain — so the user sees "an issuer was created at 0.1.3.2"
	 * rather than just "the issuer domain is satisfied". Keyed by domain name.
	 */
	satisfiedFacts: Record<string, string[]>;
};

export interface TAffordancesInputs {
	steppers: AStepper[];
	domains: Record<string, TRegisteredDomain>;
	facts: TQuad[];
	capabilities: ReadonlySet<string>;
	/** When true, the goal frontier asks the resolver to decompose composite input domains via topology.ranges. */
	compositeDecomposition?: boolean;
	/** Composite recursion depth budget passed through to the resolver. */
	compositeMaxDepth?: number;
	/**
	 * Replay the affordances at a historical point. When set, only typed facts
	 * whose seqPath subject is `≤ asOfSeqPath` enter the projection — facts
	 * asserted later in the run are dropped. Lets the panel reconstruct
	 * mid-flight state from any seqPath the user has on hand.
	 */
	asOfSeqPath?: number[];
}

/**
 * Build the affordances projection for the current execution state.
 */
export function buildAffordances(inputs: TAffordancesInputs): TAffordances {
	const graph = buildDomainChain(inputs.steppers, inputs.domains);
	const facts = inputs.asOfSeqPath ? filterFactsAsOf(inputs.facts, inputs.asOfSeqPath) : inputs.facts;
	const satisfiedDomains = [...new Set(facts.map((q) => q.predicate))].sort();
	const satisfiedFacts: Record<string, string[]> = {};
	for (const q of facts) {
		if (!satisfiedFacts[q.predicate]) satisfiedFacts[q.predicate] = [];
		satisfiedFacts[q.predicate].push(q.subject);
	}
	return {
		forward: buildForwardFrontier(graph, facts, inputs.capabilities),
		goals: buildGoalFrontier(graph, facts, inputs.capabilities, inputs.domains, inputs.compositeDecomposition, inputs.compositeMaxDepth),
		satisfiedDomains,
		satisfiedFacts,
		composites: collectCompositeRanges(inputs.domains),
	};
}

/**
 * Keep only facts whose seqPath subject is at or before the cursor. Non-
 * seqPath subjects (rare, but possible for hand-asserted facts) are kept
 * unconditionally — they have no temporal ordering against seqPaths.
 */
function filterFactsAsOf(facts: TQuad[], asOf: number[]): TQuad[] {
	return facts.filter((q) => {
		const parsed = parseSeqPath(q.subject);
		if (!parsed) return true;
		return compareSeqPath(parsed, asOf) <= 0;
	});
}

/** Project the registered domains' `topology.ranges` into the wire-format snapshot. Empty when no domain declares any ranges. */
function collectCompositeRanges(domains: Record<string, TRegisteredDomain>): TCompositeRanges | undefined {
	const out: TCompositeRanges = {};
	let any = false;
	for (const [key, def] of Object.entries(domains)) {
		const ranges = def.topology?.ranges;
		if (ranges && Object.keys(ranges).length > 0) {
			out[key] = { ...ranges };
			any = true;
		}
	}
	return any ? out : undefined;
}

function buildForwardFrontier(graph: TDomainChainGraph, facts: TQuad[], capabilities: ReadonlySet<string>): TForwardAffordance[] {
	const assertedDomains = new Set(facts.map((q) => q.predicate));
	const producedDomains = new Set<string>();
	for (const step of graph.steps) for (const d of step.outputDomains) producedDomains.add(d);
	const isArgument = (d: string) => PRIMITIVE_DOMAINS.has(d) || !producedDomains.has(d);
	const out: TForwardAffordance[] = [];
	for (const step of graph.steps) {
		if (step.capability && !capabilities.has(step.capability)) continue;
		if (step.inputDomains.length === 0 && step.outputDomains.length === 0) continue;
		const readyToRun = step.inputDomains.every((d) => isArgument(d) || assertedDomains.has(d) || d === SOURCE_DOMAIN);
		out.push({
			method: stepMethodName(step.stepperName, step.stepName),
			stepperName: step.stepperName,
			stepName: step.stepName,
			gwta: step.gwta,
			inputDomains: step.inputDomains,
			outputDomains: step.outputDomains,
			readyToRun,
			capability: step.capability,
		});
	}
	return out;
}

function buildGoalFrontier(
	graph: TDomainChainGraph,
	facts: TQuad[],
	capabilities: ReadonlySet<string>,
	domains: Record<string, TRegisteredDomain>,
	compositeDecomposition?: boolean,
	compositeMaxDepth?: number,
): TGoalAffordance[] {
	const out: TGoalAffordance[] = [];
	const producibleDomains = new Set<string>();
	for (const step of graph.steps) for (const d of step.outputDomains) producibleDomains.add(d);
	for (const domain of producibleDomains) {
		const resolution = resolveGoal(domain, { graph, facts, capabilities, domains, compositeDecomposition, compositeMaxDepth });
		// Trivial goals duplicate the forward frontier: a single producer step
		// whose inputs are all arguments — no upstream facts, no composite
		// decomposition with fact-bindings. Skip those. Paths that exercise
		// composite ranges (fact-bindings, recursive decomposition) stay visible
		// even when they collapse to one step late in a chain.
		if ((resolution.finding === GOAL_FINDING.MICHI || resolution.finding === GOAL_FINDING.SATISFIED) && Array.isArray(resolution.michi) && resolution.michi.every(isTrivialMichi)) continue;
		// Every goal-producing domain must declare a human description so the goal
		// index reads as prose, not a wall of codenames. Two sources, in order:
		//   1. `description` on the domain definition (explicit override).
		//   2. The schema's Zod `.describe(...)` metadata — the canonical place
		//      because the description travels with the schema wherever it is
		//      reused (other steppers, downstream consumers).
		// Fail loud when neither is set, naming both fix points so the omission
		// is repaired at the source of truth.
		const def = domains[domain];
		const description = def?.description ?? (typeof def?.schema?.description === "string" ? def.schema.description : "");
		if (description.length === 0) {
			throw new Error(
				`buildGoalFrontier: domain "${domain}" is goal-producing but has no description. Either add \`.describe("…")\` to its Zod schema (preferred — travels with the schema) or set \`description\` on its TDomainDefinition in the stepper's getConcerns().domains entry. Descriptions render in the goal index where users pick which goal to expand.`,
			);
		}
		out.push({ domain, description, resolution });
	}
	return out;
}

/**
 * A michi is "trivial" when it duplicates a forward-frontier entry: one
 * producer step whose every binding ultimately resolves to a user-supplied
 * argument (no facts, no chained sub-paths). Composite bindings count as
 * trivial when every field is itself an argument, since the form-rendered
 * step already exposes those fields.
 */
function isTrivialMichi(m: { steps: unknown[]; bindings: unknown[] }): boolean {
	if (m.steps.length > 1) return false;
	return m.bindings.every(isArgumentBinding);
}

function isArgumentBinding(b: unknown): boolean {
	if (!b || typeof b !== "object") return false;
	const kind = (b as { kind: string }).kind;
	if (kind === "argument") return true;
	if (kind === "composite") {
		const fields = (b as { fields?: Array<{ kind: string }> }).fields ?? [];
		return fields.every((f) => f.kind === "argument");
	}
	return false;
}
