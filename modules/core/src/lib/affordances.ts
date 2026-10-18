/**
 * Affordances list the steps a caller may call next and the resolver's finding for each goal.
 *
 * buildAffordances is a pure function over the loaded steppers, the registered domains, the asserted facts in working
 * memory and the actions the caller holds. It returns:
 *   - forward: the forward-chaining frontier. It lists each step the caller may call that declares an input or output
 *     domain. `readyToRun` is true where each input domain is an argument, has an asserted fact, or is the source
 *     domain.
 *   - goals: the resolver's finding (satisfied, michi, unreachable or refused) for each domain a step produces. It leaves
 *     out reference domains and trivial single-step goals. A michi finding carries the plan, so a client can preview it.
 *   - satisfiedDomains, satisfiedFacts and composites. TAffordances describes each.
 *
 * Affordances implement the HATEOAS step layer. A client that doesn't hold the registry requests them and receives
 * typed entries with the RPC name of each step.
 */
import type { AStepper, TFeatureStep } from "./steps/domains/stepper.js";
import type { TRegisteredDomain } from "./resources.js";
import type { TFact } from "./records/domains/facts.js";
import { stepMethodName } from "./steps/domains/step-method.js";
import { mayCall } from "./actions.js";
import { buildDomainChain, SOURCE_DOMAIN, type TDomainChainGraph } from "./domain-chain.js";
import { isPrimitiveDomain, refTargetOf } from "./domains/domains.js";
import { resolveGoal, GOAL_FINDING, type TGoalResolution } from "./goal-resolver.js";
import { compareSeqPath, factSeqPath } from "./actuality/domains/seq-path.js";

/** The event-id prefix of the `affordances.<seqPath>` change signal. The goal-resolution stepper emits it in afterStep for
 *  each step that isn't a read or a projection. SPA views filter the event stream on it and re-fetch the affordances
 *  snapshot after matching events. */
export const AFFORDANCE_EVENT_PREFIX = "affordances.";

/**
 * Returns whether a domain's value comes from a step argument. It returns true where the domain is a primitive, or where
 * `forward` doesn't contain a step that produces it, since a fact can't supply the value.
 */
export function isArgumentDomain(domain: string, forward: ReadonlyArray<{ outputDomains: string[] }>): boolean {
	if (isPrimitiveDomain(domain)) return true;
	return !forward.some((f) => f.outputDomains.includes(domain));
}

export type TForwardAffordance = {
	/** The RPC name `StepperName-stepName`. The RPC transport calls the step by this name. */
	method: string;
	stepperName: string;
	stepName: string;
	gwta?: string;
	inputDomains: string[];
	outputDomains: string[];
	/** True where each input domain is an argument, has an asserted fact, or is the source domain. */
	readyToRun: boolean;
	/** The action the caller must hold to dispatch this step, as `requiredAction` computes it. */
	capability?: string;
};

export type TGoalAffordance = { domain: string; description: string; resolution: TGoalResolution };

export const WAYPOINT_KIND = { IMPERATIVE: "imperative", DECLARATIVE: "declarative" } as const;
export type TWaypointKind = (typeof WAYPOINT_KIND)[keyof typeof WAYPOINT_KIND];

export type TWaypointEntry = {
	outcome: string;
	kind: TWaypointKind;
	method: string;
	paramSlots: string[];
	proofStatements: string[];
	resolvesDomain?: string;
	/** True where this waypoint is ensured: `ensure` ran its proof and the proof passed, or a fact satisfies its declarative goal. */
	ensured: boolean;
	error?: string;
	source: { path: string; lineNumber?: number };
	isBackground: boolean;
};

/** A stepper that contributes waypoint entries to the affordances snapshot. `show affordances` calls `waypointEntries` on
 * every registered stepper that implements it, and merges the results. `satisfiedDomains` comes from the snapshot
 * already built, so a contributor doesn't derive it again. */
export interface ProvidesWaypoints {
	waypointEntries(featureStep: TFeatureStep, satisfiedDomains: Set<string>): Promise<TWaypointEntry[]>;
}
export const providesWaypoints = (s: unknown): s is ProvidesWaypoints => typeof (s as { waypointEntries?: unknown })?.waypointEntries === "function";

/**
 * Maps each composite domain to its fields. Each field maps to the registered domain of that schema field, as
 * `topology.ranges` declares it. An atomic domain doesn't have an entry. The chain view reads it to emit synthetic field
 * nodes between a composite and its component domains.
 */
export type TCompositeRanges = Record<string, Record<string, string>>;

export type TAffordances = {
	forward: TForwardAffordance[];
	goals: TGoalAffordance[];
	composites?: TCompositeRanges;
	/**
	 * Every domain that has at least one asserted fact in working memory. `goals` leaves out trivial single-step goals,
	 * so its satisfied findings don't list every asserted domain. This list includes the domains that argument-only
	 * single-step paths produce. The chain view reads it to colour each node by whether its domain has a fact.
	 */
	satisfiedDomains: string[];
	/**
	 * Maps each domain name to the ids of its asserted facts. A fact's id is the record name of the step that produced it.
	 * The chain view reads it to render a node for each fact. The node shows the fact's id, and an edge links it to its
	 * domain node.
	 */
	satisfiedFacts: Record<string, string[]>;
};

interface TAffordancesInputs {
	steppers: AStepper[];
	domains: Record<string, TRegisteredDomain>;
	facts: TFact[];
	/** The actions the caller holds. buildAffordances doesn't offer a step the caller may not run. */
	held: string | string[] | undefined;
	/** Makes the resolver decompose composite input domains through `topology.ranges` for the goal frontier. */
	compositeDecomposition?: boolean;
	/** The resolver's composite recursion depth limit. */
	compositeMaxDepth?: number;
	/**
	 * Replays the affordances at an earlier seqPath. It limits the projection to the facts of the steps at or before this
	 * path, and leaves out facts asserted later in actuality. A fact whose id doesn't name a step stays. The panel uses it
	 * to rebuild the state at any earlier seqPath.
	 */
	asOfSeqPath?: number[];
}

/**
 * Builds the affordances projection from the given steppers, domains, facts and held actions.
 */
export function buildAffordances(inputs: TAffordancesInputs): TAffordances {
	const graph = buildDomainChain(inputs.steppers, inputs.domains);
	const facts = inputs.asOfSeqPath ? filterFactsAsOf(inputs.facts, inputs.asOfSeqPath) : inputs.facts;
	const satisfiedDomains = [...new Set(facts.map((fact) => fact.domain))].sort();
	const satisfiedFacts = Object.fromEntries([...Map.groupBy(facts, (fact) => fact.domain)].map(([domain, held]) => [domain, held.map((fact) => fact.id)]));
	return {
		forward: buildForwardFrontier(graph, facts, inputs.held),
		goals: buildGoalFrontier(graph, facts, inputs.held, inputs.domains, inputs.compositeDecomposition, inputs.compositeMaxDepth),
		satisfiedDomains,
		satisfiedFacts,
		composites: collectCompositeRanges(inputs.domains),
	};
}

/** Keeps the facts of the steps at or before `asOf`. It keeps every fact whose id doesn't name a step, since such a fact
 *  isn't ordered against step paths. */
function filterFactsAsOf(facts: TFact[], asOf: number[]): TFact[] {
	return facts.filter((fact) => {
		const path = factSeqPath(fact.id);
		return path === null || compareSeqPath(path, asOf) <= 0;
	});
}

/** Projects the registered domains' `topology.ranges` into the wire-format snapshot. Returns undefined where the domains
 *  don't declare ranges. A reference domain is left out, since it names a record of its target type. The goal frontier
 *  and the chain lint read a reference the same way. */
function collectCompositeRanges(domains: Record<string, TRegisteredDomain>): TCompositeRanges | undefined {
	const out: TCompositeRanges = {};
	let any = false;
	for (const [key, def] of Object.entries(domains)) {
		if (refTargetOf(def, domains) !== undefined) continue;
		const ranges = def.topology?.ranges;
		if (ranges && Object.keys(ranges).length > 0) {
			out[key] = { ...ranges };
			any = true;
		}
	}
	return any ? out : undefined;
}

function buildForwardFrontier(graph: TDomainChainGraph, facts: TFact[], held: string | string[] | undefined): TForwardAffordance[] {
	const assertedDomains = new Set(facts.map((fact) => fact.domain));
	const producedDomains = new Set<string>();
	for (const step of graph.steps) for (const d of step.outputDomains) producedDomains.add(d);
	const isArgument = (d: string) => isPrimitiveDomain(d) || !producedDomains.has(d);
	const out: TForwardAffordance[] = [];
	for (const step of graph.steps) {
		if (!mayCall(held, step)) continue;
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
	facts: TFact[],
	held: string | string[] | undefined,
	domains: Record<string, TRegisteredDomain>,
	compositeDecomposition?: boolean,
	compositeMaxDepth?: number,
): TGoalAffordance[] {
	const out: TGoalAffordance[] = [];
	const producibleDomains = new Set<string>();
	for (const step of graph.steps) for (const d of step.outputDomains) producibleDomains.add(d);
	for (const domain of producibleDomains) {
		// A reference names a record of its target type. The goal frontier leaves the reference out, and lists the target
		// type where a step produces it.
		if (domains[domain] && refTargetOf(domains[domain], domains) !== undefined) continue;
		const resolution = resolveGoal(domain, { graph, facts, held, domains, compositeDecomposition, compositeMaxDepth });
		// A trivial goal duplicates the forward frontier. Each of its paths is one producer step whose bindings are all
		// arguments. A path with a composite binding that holds a fact or a nested decomposition stays, even where it has
		// one step.
		if ((resolution.finding === GOAL_FINDING.MICHI || resolution.finding === GOAL_FINDING.SATISFIED) && Array.isArray(resolution.michi) && resolution.michi.every(isTrivialMichi))
			continue;
		// Every domain a step produces declares a description, and the goal index renders it as prose. The description is
		// `description` on the domain definition, or else the schema's Zod `.describe(...)` metadata. The schema metadata is
		// preferred, because every stepper and consumer that reuses the schema reads it. buildGoalFrontier throws for a domain
		// that doesn't declare either, and the error names both places to declare one.
		const def = domains[domain];
		const description = def?.description ?? (typeof def?.schema?.description === "string" ? def.schema.description : "");
		if (description.length === 0) {
			throw new Error(
				`buildGoalFrontier: domain "${domain}" is a goal, and it doesn't have a description. Add \`.describe("…")\` to its Zod schema, or set \`description\` on its TDomainDefinition in the stepper's getConcerns().domains entry. Every stepper that reuses the schema reads the Zod description. The goal index renders each description, and a person reads it to select a goal to expand.`,
			);
		}
		out.push({ domain, description, resolution });
	}
	return out;
}

/**
 * A michi is trivial where it duplicates a forward-frontier entry. It doesn't have more than one step, and each binding
 * is an argument a person supplies. A composite binding counts as an argument where each of its fields is an argument,
 * since the form for that step renders those fields.
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

/** Returns the domains whose goal finding is `satisfiedFinding`. The server's waypoint pass and the client panel both call this one function. */
export function satisfiedGoalDomains(goals: ReadonlyArray<{ domain: string; resolution: { finding: string } }>, satisfiedFinding: string): Set<string> {
	return new Set(goals.filter((g) => g.resolution.finding === satisfiedFinding).map((g) => g.domain));
}
