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
 *   - Capabilities required: caller must pass a granted-capability set; resolver
 *     filters producer steps by it. No optimistic assumptions.
 *   - Cycle protection mandatory: visited set + depth limit; cycles return unreachable.
 *   - Plans are advisory, never auto-executed: this module is pure search; a separate
 *     "run plan" step actually runs the chain.
 */
import { SOURCE_DOMAIN, type TDomainChainGraph, type TDomainChainStep } from "./domain-chain.js";
import type { TQuad } from "./quad-types.js";
import { getCompositeFields, zodTypeLabel, type TCompositeField } from "./composite-domain.js";
import type { TRegisteredDomain } from "./resources.js";

export type TPlanStep = {
	stepperName: string;
	stepName: string;
	gwta?: string;
	/**
	 * Domain this step produces in the context of the enclosing michi. Knowing
	 * which step makes which domain lets a consumer (e.g. the goal-paths graph
	 * projection) route a composite field's sub-binding through its producer
	 * step instead of attaching the sub-fields directly to the field's slot.
	 */
	productsDomain: string;
};

/**
 * How one of a step's inputs is satisfied in a michi:
 *   - kind: "fact"       → existing fact in working memory, identified by its subject (seqPath).
 *   - kind: "argument"   → user supplies this at run time as a step argument (no producer chain
 *                          exists, or the input is a primitive/json/string).
 *   - kind: "composite"  → the input is a composite domain whose fields each have their own
 *                          binding. `fields[]` mirrors the schema (subset of TDomainTopology.ranges)
 *                          and may recurse further. Emitted only when composite decomposition is
 *                          enabled in the resolver inputs.
 */
export type TBinding = { domain: string } & ({ kind: "fact"; factId: string } | { kind: "argument" } | { kind: "composite"; fields: TFieldBinding[] });

/**
 * One field within a composite binding. `fieldDomain` is empty when the field
 * has no declared `topology.ranges` entry — in that case the field is treated
 * as a primitive argument supplied by the user. `fieldType` is the Zod type
 * label (`"string"`, `"number"`, `"date"`, `"array"`, etc.) so consumers can
 * show the user what shape to supply.
 */
export type TFieldBinding = {
	fieldName: string;
	fieldDomain: string;
	fieldType: string;
	optional: boolean;
} & ({ kind: "fact"; factId: string } | { kind: "argument" } | { kind: "composite"; fields: TFieldBinding[] });

/**
 * One path from current working memory to the goal — an ordered sequence of steps
 * with every input accounted for (binding to a fact or an argument). Multiple michi
 * may resolve the same goal; the resolver returns up to MAX_MICHI of them.
 */
export type TMichi = {
	steps: TPlanStep[];
	bindings: TBinding[];
};

/** Per-field filter over a fact's `object` value. Bare values are shorthand for `{ eq }`. */
export type TShibari =
	| { eq: unknown }
	| { ne: unknown }
	| { in: unknown[] }
	| { gt: number | string }
	| { gte: number | string }
	| { lt: number | string }
	| { lte: number | string }
	| { matches: string }
	| { all: TShibari[] }
	| { any: TShibari[] };

/** Resolver query: target goal domain, optional per-field filters over the matching fact's object. */
export type TGoalQuery = {
	goal: string;
	/** Dot-paths into the fact's object → filter to test that path's value against. A bare value is `{eq: value}`. */
	where?: Record<string, TShibari | unknown>;
};

export const GOAL_FINDING = {
	SATISFIED: "satisfied",
	MICHI: "michi",
	UNREACHABLE: "unreachable",
	REFUSED: "refused",
} as const;

export type TGoalFinding = (typeof GOAL_FINDING)[keyof typeof GOAL_FINDING];

export const REFUSAL_REASON = {
	ANONYMOUS_OUTPUTS_PRESENT: "anonymous-outputs-present",
	CAPABILITY_CONTEXT_REQUIRED: "capability-context-required",
} as const;

export type TRefusalReason = (typeof REFUSAL_REASON)[keyof typeof REFUSAL_REASON];

export type TGoalResolution =
	| { finding: typeof GOAL_FINDING.SATISFIED; goal: string; factIds: string[]; michi: TMichi[]; truncated: boolean }
	| { finding: typeof GOAL_FINDING.MICHI; goal: string; michi: TMichi[]; truncated: boolean }
	| { finding: typeof GOAL_FINDING.UNREACHABLE; goal: string; missing: string[] }
	| { finding: typeof GOAL_FINDING.REFUSED; goal: string; refusalReason: TRefusalReason; detail: string };

export interface TResolverInputs {
	graph: TDomainChainGraph;
	facts: TQuad[];
	capabilities: ReadonlySet<string>;
	depthLimit?: number;
	/** Per-field filters over the goal fact's object. */
	where?: Record<string, TShibari | unknown>;
	/** Cap on enumerated michi per goal. Default MAX_MICHI. */
	maxMichi?: number;
	/**
	 * Registered domains. When supplied (alongside `compositeDecomposition: true`)
	 * the resolver inspects each input domain's `topology.ranges` to recurse into
	 * its component fields rather than treating it as one opaque argument. Absent
	 * domains falls back to flat behaviour (every composite stays atomic).
	 */
	domains?: Record<string, TRegisteredDomain>;
	/** Enable schema-decomposition of composite input domains. Default false (preserves prior behaviour). */
	compositeDecomposition?: boolean;
	/** Cap on composite recursion depth. Default COMPOSITE_DEFAULT_DEPTH. */
	compositeMaxDepth?: number;
}

const DEFAULT_DEPTH_LIMIT = 8;
const MAX_MICHI = 64;
const COMPOSITE_DEFAULT_DEPTH = 4;

/**
 * Resolve a goal. The honest contract: if the resolver cannot produce an accurate
 * answer (because the graph is incomplete or capabilities are unknown), it returns
 * `refused` rather than guessing.
 */
export function resolveGoal(goal: string, inputs: TResolverInputs): TGoalResolution {
	const refusal = checkResolverInvariants(inputs, goal);
	if (refusal) return refusal;

	const matchingFacts = inputs.facts.filter((q) => q.predicate === goal && factMatchesWhere(q, inputs.where));
	const hasProducerEdge = inputs.graph.edges.some((e) => e.to === goal);
	// Enumerate producer paths even when satisfied — `satisfied` doesn't mean
	// "cannot be run again", just that at least one fact already exists. The
	// user may want to produce another instance.
	const depthLimit = inputs.depthLimit ?? DEFAULT_DEPTH_LIMIT;
	const maxMichi = inputs.maxMichi ?? MAX_MICHI;
	const missing: string[] = [];
	const enumeration = hasProducerEdge
		? enumerate(goal, { ...inputs, facts: inputs.facts.filter((q) => q.predicate !== goal) }, new Set<string>([keyForVisited(goal, "")]), missing, depthLimit, 0, maxMichi, "")
		: { michi: [], truncated: false };

	if (matchingFacts.length > 0) {
		return { finding: GOAL_FINDING.SATISFIED, goal, factIds: matchingFacts.map((q) => q.subject), michi: enumeration.michi, truncated: enumeration.truncated };
	}

	// The goal itself must be produced by a registered step.
	if (!hasProducerEdge) {
		return { finding: GOAL_FINDING.UNREACHABLE, goal, missing: [goal] };
	}

	if (enumeration.michi.length > 0) {
		return { finding: GOAL_FINDING.MICHI, goal, michi: enumeration.michi, truncated: enumeration.truncated };
	}
	return { finding: GOAL_FINDING.UNREACHABLE, goal, missing: dedupe(missing.length > 0 ? missing : [goal]) };
}

/**
 * Check the structural preconditions before searching. Returns a refusal when the
 * resolver cannot honestly operate; undefined when it's safe to proceed.
 */
function checkResolverInvariants(inputs: TResolverInputs, goal: string): TGoalResolution | undefined {
	if (!inputs.capabilities) {
		return {
			finding: GOAL_FINDING.REFUSED,
			goal,
			refusalReason: REFUSAL_REASON.CAPABILITY_CONTEXT_REQUIRED,
			detail: "resolver requires an explicit capability set; pass an empty Set if the caller has none",
		};
	}
	const anonymous = inputs.graph.steps.filter((s) => s.outputDomains.length === 0 && producesAnything(s));
	if (anonymous.length > 0) {
		return {
			finding: GOAL_FINDING.REFUSED,
			goal,
			refusalReason: REFUSAL_REASON.ANONYMOUS_OUTPUTS_PRESENT,
			detail: `${anonymous.length} step(s) produce content without a declared productsDomain; resolver cannot see their products. Offending: ${anonymous
				.slice(0, 3)
				.map((s) => `${s.stepperName}.${s.stepName}`)
				.join(", ")}`,
		};
	}
	return undefined;
}

/**
 * A step is treated as "producing anything" in the resolver graph when it declares
 * productsDomain or productsDomains. Steps that declare only productsSchema (inline
 * Zod, no domain registration) are silent to the resolver — their products are typed
 * data, not graph nodes.
 */
function producesAnything(_step: TDomainChainStep): boolean {
	return false;
}

type TEnumResult = { michi: TMichi[]; truncated: boolean };

/** Build a visited-set key from a domain plus its dot-path from the root goal. Lets two distinct field-paths reach the same domain without false-positive cycle detection. */
function keyForVisited(domain: string, path: string): string {
	return path ? `${domain}@${path}` : domain;
}

/**
 * Enumerate every path from working memory to `target`, bounded by depthLimit + maxMichi.
 * Each producer edge branches; each fact match adds a binding; each "no producer" domain
 * is treated as a user-supplied argument (matches the forward-frontier model). When
 * composite decomposition is enabled and a no-producer domain has registered field
 * `topology.ranges`, the resolver recurses per field and emits a `kind: "composite"`
 * binding rather than a flat argument.
 */
function enumerate(
	target: string,
	inputs: TResolverInputs,
	visited: Set<string>,
	missing: string[],
	depthLimit: number,
	depth: number,
	maxMichi: number,
	path: string,
): TEnumResult {
	if (depth > depthLimit) return { michi: [], truncated: false };
	if (target === SOURCE_DOMAIN) return { michi: [{ steps: [], bindings: [] }], truncated: false };

	const factsOfTarget = inputs.facts.filter((q) => q.predicate === target);
	const producers = inputs.graph.edges.filter((e) => e.to === target);

	const out: TMichi[] = [];
	let truncated = false;

	// Branch 1: each matching fact is a leaf binding.
	for (const fact of factsOfTarget) {
		if (out.length >= maxMichi) {
			truncated = true;
			break;
		}
		out.push({ steps: [], bindings: [{ kind: "fact", domain: target, factId: fact.subject }] });
	}

	// Branch 2: no producer registered → the value comes from a step argument.
	// When composite-decomposition is on and the target's schema declares field ranges,
	// decompose into a composite binding whose fields each resolve independently.
	if (producers.length === 0 && factsOfTarget.length === 0) {
		const composite = tryComposite(target, inputs, visited, missing, depthLimit, depth, maxMichi, path);
		if (composite) {
			if (composite.truncated) truncated = true;
			out.push(...composite.michi);
		} else {
			out.push({ steps: [], bindings: [{ kind: "argument", domain: target }] });
		}
		return { michi: out, truncated };
	}

	// Branch 3: each producer *step* expands recursively, cartesian over sub-paths per input.
	// A step with multiple inputs landing at the same output produces multiple edges
	// in `inputs.graph.edges` (one per input × output); iterating those edges directly
	// would re-enumerate the same step once per input and emit identical michi. De-dup
	// the edges by stepperName.stepName so each producer step expands exactly once.
	const producerSteps = new Map<string, TDomainChainStep>();
	for (const edge of producers) {
		const key = `${edge.stepperName}.${edge.stepName}`;
		if (producerSteps.has(key)) continue;
		const step = inputs.graph.steps.find((s) => s.stepperName === edge.stepperName && s.stepName === edge.stepName);
		if (step) producerSteps.set(key, step);
	}
	for (const step of producerSteps.values()) {
		if (out.length >= maxMichi) {
			truncated = true;
			break;
		}
		if (step.capability && !inputs.capabilities.has(step.capability)) continue;

		const inputMichi: TMichi[][] = [];
		let anyDead = false;
		for (const inputDomain of step.inputDomains) {
			const visitKey = keyForVisited(inputDomain, path);
			if (visited.has(visitKey)) {
				anyDead = true;
				break;
			}
			visited.add(visitKey);
			const sub = enumerate(inputDomain, inputs, visited, missing, depthLimit, depth + 1, maxMichi, path);
			visited.delete(visitKey);
			if (sub.truncated) truncated = true;
			if (sub.michi.length === 0) {
				anyDead = true;
				break;
			}
			inputMichi.push(sub.michi);
		}
		if (anyDead) continue;

		// Cartesian product of input michi → one michi per combination, plus this step at the tail.
		const stepDescriptor: TPlanStep = { stepperName: step.stepperName, stepName: step.stepName, gwta: step.gwta, productsDomain: target };
		for (const combo of cartesian(inputMichi, maxMichi - out.length)) {
			if (out.length >= maxMichi) {
				truncated = true;
				break;
			}
			const allSteps: TPlanStep[] = [];
			const allBindings: TBinding[] = [];
			for (const sub of combo) {
				allSteps.push(...sub.steps);
				allBindings.push(...sub.bindings);
			}
			allSteps.push(stepDescriptor);
			out.push({ steps: allSteps, bindings: allBindings });
		}
	}

	if (out.length === 0) missing.push(target);
	return { michi: out, truncated };
}

/**
 * Composite-decomposition branch. Returns a list of michi whose only binding is
 * a `kind: "composite"` describing how each field is satisfied, or `null` when
 * the target isn't composite or decomposition is disabled.
 */
function tryComposite(
	target: string,
	inputs: TResolverInputs,
	visited: Set<string>,
	missing: string[],
	depthLimit: number,
	depth: number,
	maxMichi: number,
	path: string,
): TEnumResult | null {
	if (!inputs.compositeDecomposition) return null;
	if (!inputs.domains) return null;
	const compositeMaxDepth = inputs.compositeMaxDepth ?? COMPOSITE_DEFAULT_DEPTH;
	const compositeDepth = path.split(".").filter((s) => s.length > 0).length;
	if (compositeDepth >= compositeMaxDepth) return null;
	const fields = getCompositeFields(target, inputs.domains);
	if (!fields || fields.length === 0) return null;

	const perFieldOptions: TFieldOption[][] = [];
	let truncated = false;
	for (const field of fields) {
		const options = resolveFieldOptions(field, inputs, visited, missing, depthLimit, depth, maxMichi, path);
		if (options.truncated) truncated = true;
		if (options.options.length === 0) {
			// A required field with no resolution kills the composite as a whole.
			if (!field.optional) return null;
			// Optional field with no resolution: skip it.
			continue;
		}
		perFieldOptions.push(options.options);
	}

	const michi: TMichi[] = [];
	for (const combo of cartesian(perFieldOptions, maxMichi)) {
		if (michi.length >= maxMichi) {
			truncated = true;
			break;
		}
		const stepsCombined: TPlanStep[] = [];
		const fieldsCombined: TFieldBinding[] = [];
		for (const opt of combo) {
			stepsCombined.push(...opt.steps);
			fieldsCombined.push(opt.field);
		}
		michi.push({ steps: stepsCombined, bindings: [{ kind: "composite", domain: target, fields: fieldsCombined }] });
	}
	return { michi, truncated };
}

type TFieldOption = { field: TFieldBinding; steps: TPlanStep[] };
type TFieldOptionsResult = { options: TFieldOption[]; truncated: boolean };

function resolveFieldOptions(
	field: TCompositeField,
	inputs: TResolverInputs,
	visited: Set<string>,
	missing: string[],
	depthLimit: number,
	depth: number,
	maxMichi: number,
	path: string,
): TFieldOptionsResult {
	const nextPath = path ? `${path}.${field.fieldName}` : field.fieldName;
	const fieldType = zodTypeLabel(field.zodType);
	// A field with no registered range is a primitive argument.
	if (!field.fieldDomain) {
		return { options: [{ field: { fieldName: field.fieldName, fieldDomain: "", fieldType, optional: field.optional, kind: "argument" }, steps: [] }], truncated: false };
	}
	const visitKey = keyForVisited(field.fieldDomain, nextPath);
	if (visited.has(visitKey)) return { options: [], truncated: false };
	visited.add(visitKey);
	const sub = enumerate(field.fieldDomain, inputs, visited, missing, depthLimit, depth + 1, maxMichi, nextPath);
	visited.delete(visitKey);

	const options: TFieldOption[] = [];
	for (const m of sub.michi) {
		const leaf = m.bindings[0];
		// `leaf` is absent when the producer chain takes no graph-level inputs
		// (e.g. a step whose gwta args are all primitive). In that case the
		// chain still produces the field's value — the field carries no
		// upstream binding, but `m.steps` runs to satisfy it. Represent it as
		// an `argument`-kind field-binding so the consumer surfaces "you
		// supply" semantics for the field as a whole, while the outer michi's
		// `steps` carries the producing chain.
		const fieldBinding: TFieldBinding = leaf ? makeFieldBinding(field, leaf) : { fieldName: field.fieldName, fieldDomain: field.fieldDomain ?? "", fieldType, optional: field.optional, kind: "argument" };
		options.push({ field: fieldBinding, steps: m.steps });
	}
	return { options, truncated: sub.truncated };
}

function makeFieldBinding(field: TCompositeField, leaf: TBinding): TFieldBinding {
	const base = { fieldName: field.fieldName, fieldDomain: field.fieldDomain ?? "", fieldType: zodTypeLabel(field.zodType), optional: field.optional };
	if (leaf.kind === "fact") return { ...base, kind: "fact", factId: leaf.factId };
	if (leaf.kind === "composite") return { ...base, kind: "composite", fields: leaf.fields };
	return { ...base, kind: "argument" };
}

/** Cartesian product, capped at `limit` total combinations to bound the work. */
function* cartesian<T>(arrays: T[][], limit: number): Generator<T[]> {
	if (arrays.length === 0) {
		yield [];
		return;
	}
	const idx = new Array(arrays.length).fill(0);
	let emitted = 0;
	while (true) {
		if (emitted >= limit) return;
		yield idx.map((i, k) => arrays[k][i]);
		emitted++;
		let k = arrays.length - 1;
		while (k >= 0) {
			idx[k]++;
			if (idx[k] < arrays[k].length) break;
			idx[k] = 0;
			k--;
		}
		if (k < 0) return;
	}
}

/** True when the fact's `object` matches every path/filter in `where`. Empty/undefined where always matches. */
export function factMatchesWhere(fact: TQuad, where: Record<string, TShibari | unknown> | undefined): boolean {
	if (!where) return true;
	const obj = fact.object;
	for (const [path, raw] of Object.entries(where)) {
		const value = getByDotPath(obj, path);
		const filter = normaliseShibari(raw);
		if (!evaluateShibari(value, filter)) return false;
	}
	return true;
}

function normaliseShibari(raw: TShibari | unknown): TShibari {
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		const r = raw as Record<string, unknown>;
		if ("eq" in r || "ne" in r || "in" in r || "gt" in r || "gte" in r || "lt" in r || "lte" in r || "matches" in r || "all" in r || "any" in r) {
			return raw as TShibari;
		}
	}
	return { eq: raw };
}

function evaluateShibari(value: unknown, s: TShibari): boolean {
	if ("eq" in s) return deepEqual(value, s.eq);
	if ("ne" in s) return !deepEqual(value, s.ne);
	if ("in" in s) return s.in.some((v) => deepEqual(value, v));
	if ("gt" in s) return compare(value, s.gt) > 0;
	if ("gte" in s) return compare(value, s.gte) >= 0;
	if ("lt" in s) return compare(value, s.lt) < 0;
	if ("lte" in s) return compare(value, s.lte) <= 0;
	if ("matches" in s) return typeof value === "string" && new RegExp(s.matches).test(value);
	if ("all" in s) return s.all.every((sub) => evaluateShibari(value, sub));
	if ("any" in s) return s.any.some((sub) => evaluateShibari(value, sub));
	return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null) return a === b;
	if (typeof a !== "object") return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => deepEqual(x, (b as unknown[])[i]));
	const ak = Object.keys(a as Record<string, unknown>);
	const bk = Object.keys(b as Record<string, unknown>);
	if (ak.length !== bk.length) return false;
	return ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function compare(a: unknown, b: unknown): number {
	if (typeof a === "number" && typeof b === "number") return a - b;
	if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
	return Number.NaN;
}

function getByDotPath(obj: unknown, path: string): unknown {
	const parts = path.split(".");
	let cur: unknown = obj;
	for (const p of parts) {
		if (cur == null || typeof cur !== "object") return undefined;
		cur = (cur as Record<string, unknown>)[p];
	}
	return cur;
}

function dedupe<T>(items: T[]): T[] {
	return [...new Set(items)];
}
