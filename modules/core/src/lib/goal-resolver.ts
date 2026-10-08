/**
 * The goal resolver chains backward over the domain-chain graph.
 *
 * resolveGoal reads the facts in working memory and searches for sequences of steps whose execution would assert a fact
 * of the goal domain. It returns one of four findings:
 *   - `satisfied`: working memory already holds a matching fact.
 *   - `michi`: one or more step chains reach the goal.
 *   - `unreachable`: the search doesn't find a producer chain the caller may call.
 *   - `refused`: `held` is undefined, so the resolver can't select the steps the caller may call.
 *
 * Invariants:
 *   - The resolver reads the same TDomainChainGraph that dispatch traverses.
 *   - The resolver requires `held`. It skips a producer step the caller may not call, and it returns `refused` when
 *     `held` is undefined.
 *   - A visited set and a depth limit stop cycles. A goal that only a cycle reaches is `unreachable`.
 *   - This module only searches, and it doesn't execute a michi. A step such as `pursue {goal}` executes one.
 */
import { z } from "zod";
import { itemAt } from "./util/item-at.js";
import { navigateValue } from "./util/dot-path.js";
import { SOURCE_DOMAIN, type TDomainChainGraph, type TDomainChainStep } from "./domain-chain.js";
import type { TQuad } from "./quad-types.js";
import { getCompositeFields, zodTypeLabel, type TCompositeField } from "./composite-domain.js";
import type { TRegisteredDomain } from "./resources.js";
import { mayCall } from "./actions.js";

type TPlanStep = {
	stepperName: string;
	stepName: string;
	gwta?: string;
	/**
	 * The domain this step produces in the enclosing michi. A consumer such as the goal-paths graph projection reads
	 * it to route a composite field's sub-binding through its producer step, instead of attaching the sub-fields to the
	 * field's slot.
	 */
	productsDomain: string;
};

/**
 * How a michi satisfies one of a step's inputs:
 *   - kind: "fact"       → an existing fact in working memory, identified by its subject (seqPath).
 *   - kind: "argument"   → a person supplies the value as a step argument when the step executes. This applies when
 *                          a producer chain doesn't exist, or when the input is a primitive, json or string.
 *   - kind: "composite"  → the input is a composite domain, and each of its fields has its own binding.
 *                          `fields[]` lists the schema's fields and leaves out an optional field that doesn't
 *                          resolve. A field's `topology.ranges` entry names its domain, and a field binding may recurse.
 *                          The resolver emits it only when the inputs enable composite decomposition.
 */
export type TBinding = { domain: string } & ({ kind: "fact"; factId: string } | { kind: "argument" } | { kind: "composite"; fields: TFieldBinding[] });

/**
 * One field of a composite binding. `fieldDomain` is empty when the field doesn't have a declared `topology.ranges`
 * entry. Such a field is a primitive argument. `fieldType` is the Zod type label (`"string"`, `"number"`, `"date"`,
 * `"array"` and others), so a consumer can show the shape of the value to supply.
 */
export type TFieldBinding = { fieldName: string; fieldDomain: string; fieldType: string; optional: boolean } & (
	| { kind: "fact"; factId: string }
	| { kind: "argument" }
	| { kind: "composite"; fields: TFieldBinding[] }
);

/**
 * One path from working memory to the goal. It holds an ordered sequence of steps and a binding for every input.
 * Several michi may resolve one goal. The resolver returns up to `maxMichi` of them.
 */
export type TMichi = { steps: TPlanStep[]; bindings: TBinding[] };

const ShibariBoundSchema = z.union([z.number(), z.string()]);

/** Per-field filter over a fact's `object` value. Bare values are shorthand for `{ eq }`. */
const ShibariSchema = z.union([
	z.object({ eq: z.unknown() }),
	z.object({ ne: z.unknown() }),
	z.object({ in: z.array(z.unknown()) }),
	z.object({ gt: ShibariBoundSchema }),
	z.object({ gte: ShibariBoundSchema }),
	z.object({ lt: ShibariBoundSchema }),
	z.object({ lte: ShibariBoundSchema }),
	z.object({ matches: z.string() }),
	z.object({
		get all() {
			return z.array(ShibariSchema);
		},
	}),
	z.object({
		get any() {
			return z.array(ShibariSchema);
		},
	}),
]);
type TShibari = z.infer<typeof ShibariSchema>;

const SHIBARI_OPERATORS = ShibariSchema.options.flatMap((option) => Object.keys(option.shape));

export const GOAL_FINDING = { SATISFIED: "satisfied", MICHI: "michi", UNREACHABLE: "unreachable", REFUSED: "refused" } as const;

export const REFUSAL_REASON = { CAPABILITY_CONTEXT_REQUIRED: "capability-context-required" } as const;

type TRefusalReason = (typeof REFUSAL_REASON)[keyof typeof REFUSAL_REASON];

export type TGoalResolution =
	| { finding: typeof GOAL_FINDING.SATISFIED; goal: string; factIds: string[]; michi: TMichi[]; truncated: boolean }
	| { finding: typeof GOAL_FINDING.MICHI; goal: string; michi: [TMichi, ...TMichi[]]; truncated: boolean }
	| { finding: typeof GOAL_FINDING.UNREACHABLE; goal: string; missing: string[] }
	| { finding: typeof GOAL_FINDING.REFUSED; goal: string; refusalReason: TRefusalReason; detail: string };

export interface TResolverInputs {
	graph: TDomainChainGraph;
	facts: TQuad[];
	/** The capabilities the caller holds, in the form dispatch reads. The resolver skips a producer step the caller may not call. */
	held: string | string[] | undefined;
	depthLimit?: number;
	/** Per-field filters over the goal fact's object. */
	where?: Record<string, TShibari | unknown>;
	/** Cap on enumerated michi per goal. Default MAX_MICHI. */
	maxMichi?: number;
	/**
	 * Registered domains. The resolver reads each input domain's schema fields and `topology.ranges` from them when
	 * `compositeDecomposition` is true. It recurses into the component fields instead of treating the domain as one
	 * opaque argument. Every composite stays one argument when `domains` is absent.
	 */
	domains?: Record<string, TRegisteredDomain>;
	/** Enables schema decomposition of composite input domains. Default false. */
	compositeDecomposition?: boolean;
	/** Cap on composite recursion depth. Default COMPOSITE_DEFAULT_DEPTH. */
	compositeMaxDepth?: number;
}

const DEFAULT_DEPTH_LIMIT = 8;
const MAX_MICHI = 64;
const COMPOSITE_DEFAULT_DEPTH = 4;

/** The most enumerate() calls one resolveGoal call makes. Cartesian fanout across composite fields can reach millions
 * of calls before depthLimit and maxMichi truncate it. enumerate() throws past this limit, so a resolution doesn't hang a
 * test or an RPC call. A typical resolution makes fewer than 10,000 calls. */
const ENUMERATE_LIMIT = 200_000;

/** The state of one resolution: its inputs, the domains on the current path, the domains that didn't yield a michi, its
 *  bounds and its count of enumerate() calls. */
type TWalk = { inputs: TResolverInputs; visited: Set<string>; missing: string[]; depthLimit: number; maxMichi: number; calls: number };

/**
 * Resolves a goal. Returns `refused` when `held` is undefined, since a search without the caller's capabilities can't
 * select the steps the caller may call.
 */
export function resolveGoal(goal: string, inputs: TResolverInputs): TGoalResolution {
	const refusal = checkResolverInvariants(inputs, goal);
	if (refusal) return refusal;

	const where = whereFilters(inputs.where);
	const matchingFacts = inputs.facts.filter((q) => q.predicate === goal && factMatchesWhere(q, where));
	const hasProducerEdge = inputs.graph.edges.some((e) => e.to === goal);
	// Producer paths are enumerated for a satisfied goal too. `satisfied` means at least one matching fact exists.
	// It doesn't stop a person producing another instance.
	const walk: TWalk = {
		inputs: { ...inputs, facts: inputs.facts.filter((q) => q.predicate !== goal) },
		visited: new Set<string>([keyForVisited(goal, "")]),
		missing: [],
		depthLimit: inputs.depthLimit ?? DEFAULT_DEPTH_LIMIT,
		maxMichi: inputs.maxMichi ?? MAX_MICHI,
		calls: 0,
	};
	const t0 = Date.now();
	const enumeration = hasProducerEdge ? enumerate(goal, walk, 0, "") : { michi: [], truncated: false };
	const elapsed = Date.now() - t0;
	if (elapsed > 500) console.warn(`[goal-resolver] resolveGoal(${goal}) took ${elapsed}ms, ${walk.calls} enumerate calls, ${enumeration.michi.length} michi`);

	if (matchingFacts.length > 0) {
		return { finding: GOAL_FINDING.SATISFIED, goal, factIds: matchingFacts.map((q) => q.subject), michi: enumeration.michi, truncated: enumeration.truncated };
	}

	// The goal itself must be produced by a registered step.
	if (!hasProducerEdge) {
		return { finding: GOAL_FINDING.UNREACHABLE, goal, missing: [goal] };
	}

	const [first, ...more] = enumeration.michi;
	if (first) return { finding: GOAL_FINDING.MICHI, goal, michi: [first, ...more], truncated: enumeration.truncated };
	return { finding: GOAL_FINDING.UNREACHABLE, goal, missing: dedupe(walk.missing.length > 0 ? walk.missing : [goal]) };
}

/**
 * Checks the preconditions of a search. Returns a refusal when `held` is undefined, and undefined otherwise.
 */
function checkResolverInvariants(inputs: TResolverInputs, goal: string): TGoalResolution | undefined {
	if (inputs.held === undefined) {
		return {
			finding: GOAL_FINDING.REFUSED,
			goal,
			refusalReason: REFUSAL_REASON.CAPABILITY_CONTEXT_REQUIRED,
			detail: "the resolver searches for what a caller may run, so it requires what the caller holds; pass an empty list for a caller that doesn't hold a capability",
		};
	}
	return undefined;
}

type TEnumResult = { michi: TMichi[]; truncated: boolean };

/** Builds a visited-set key from a domain and its dot-path from the root goal. Two field paths can then reach one domain without a false cycle. */
function keyForVisited(domain: string, path: string): string {
	return path ? `${domain}@${path}` : domain;
}

/**
 * Enumerates every path from working memory to `target`, within depthLimit and maxMichi. Each producer step adds a
 * branch. Each fact of the target domain adds a fact binding. A domain without a producer or a fact becomes an argument
 * a person supplies, as isArgumentDomain in affordances.ts treats it. Such a domain gets a `kind: "composite"` binding
 * instead when its registered schema declares fields and composite decomposition is enabled. The resolver then recurses
 * into each field.
 */
function enumerate(target: string, walk: TWalk, depth: number, path: string): TEnumResult {
	const { inputs, visited, missing, depthLimit, maxMichi } = walk;
	if (++walk.calls > ENUMERATE_LIMIT) {
		throw new Error(
			`[goal-resolver] enumerate() limit of ${ENUMERATE_LIMIT} calls exceeded for target=${target} depth=${depth} path=${path}. The visited set doesn't detect a recursive field-domain reference or a cartesian product of composite fields, so one of these is the probable cause; check the target's field domains. visited=[${[...visited].slice(0, 10).join(", ")}${visited.size > 10 ? `, ...${visited.size} total` : ""}]`,
		);
	}
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

	// Branch 2: a target without a registered producer or a fact takes its value from a step argument.
	// A target whose registered schema declares fields becomes a composite binding when composite decomposition is on.
	// Each of its fields resolves independently.
	if (producers.length === 0 && factsOfTarget.length === 0) {
		const composite = tryComposite(target, walk, depth, path);
		if (composite) {
			if (composite.truncated) truncated = true;
			out.push(...composite.michi);
		} else {
			out.push({ steps: [], bindings: [{ kind: "argument", domain: target }] });
		}
		return { michi: out, truncated };
	}

	// Branch 3: each producer *step* expands recursively, as a cartesian product over the sub-paths of its inputs.
	// A step with several inputs has one edge per input × output in `inputs.graph.edges`. Expanding each edge would
	// enumerate the step once per input and emit identical michi. The edges are de-duplicated by stepperName.stepName,
	// so each producer step expands once.
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
		if (!mayCall(inputs.held, step)) continue;

		const inputMichi: TMichi[][] = [];
		let anyDead = false;
		for (const inputDomain of step.inputDomains) {
			const visitKey = keyForVisited(inputDomain, path);
			if (visited.has(visitKey)) {
				anyDead = true;
				break;
			}
			visited.add(visitKey);
			const sub = enumerate(inputDomain, walk, depth + 1, path);
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
 * The composite-decomposition branch. Returns michi whose only binding is a `kind: "composite"` binding for the target.
 * The binding states how each field is satisfied. Returns `null` when decomposition is disabled, `domains` is absent,
 * the path reaches compositeMaxDepth, the target doesn't declare fields, or a required field doesn't resolve.
 */
function tryComposite(target: string, walk: TWalk, depth: number, path: string): TEnumResult | null {
	const { inputs, maxMichi } = walk;
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
		const options = resolveFieldOptions(field, walk, depth, path);
		if (options.truncated) truncated = true;
		if (options.options.length === 0) {
			// A required field without a resolution fails the composite as a whole.
			if (!field.optional) return null;
			// An optional field without a resolution is left out.
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

function resolveFieldOptions(field: TCompositeField, walk: TWalk, depth: number, path: string): TFieldOptionsResult {
	const { visited } = walk;
	const nextPath = path ? `${path}.${field.fieldName}` : field.fieldName;
	const fieldType = zodTypeLabel(field.zodType);
	// A field without a registered range is a primitive argument.
	if (!field.fieldDomain) {
		return { options: [{ field: { fieldName: field.fieldName, fieldDomain: "", fieldType, optional: field.optional, kind: "argument" }, steps: [] }], truncated: false };
	}
	const visitKey = keyForVisited(field.fieldDomain, nextPath);
	if (visited.has(visitKey)) return { options: [], truncated: false };
	visited.add(visitKey);
	const sub = enumerate(field.fieldDomain, walk, depth + 1, nextPath);
	visited.delete(visitKey);

	const options: TFieldOption[] = [];
	for (const m of sub.michi) {
		const leaf = m.bindings[0];
		// `leaf` is absent when the producer chain doesn't take graph-level inputs, such as a step whose gwta arguments are
		// all primitive. The chain still produces the field's value. The field doesn't carry an upstream binding, and the
		// steps in `m.steps` satisfy it. The field binding is an `argument` kind, so the consumer shows the whole field as a value to
		// supply. The outer michi's `steps` carries the producing chain.
		const fieldBinding: TFieldBinding = leaf
			? makeFieldBinding(field, leaf)
			: { fieldName: field.fieldName, fieldDomain: field.fieldDomain ?? "", fieldType, optional: field.optional, kind: "argument" };
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

/** Yields the cartesian product of `arrays`, up to `limit` combinations. */
function* cartesian<T>(arrays: T[][], limit: number): Generator<T[]> {
	if (arrays.length === 0) {
		yield [];
		return;
	}
	const idx = new Array(arrays.length).fill(0);
	let emitted = 0;
	while (true) {
		if (emitted >= limit) return;
		yield idx.map((i, k) => itemAt(itemAt(arrays, k), i));
		emitted++;
		let k = arrays.length - 1;
		while (k >= 0) {
			idx[k]++;
			if (idx[k] < itemAt(arrays, k).length) break;
			idx[k] = 0;
			k--;
		}
		if (k < 0) return;
	}
}

/** Splits each path in `where` into its segments and pairs it with its filter. resolveGoal computes the pairs once and checks every fact against them. */
function whereFilters(where: Record<string, TShibari | unknown> | undefined): [string[], TShibari][] {
	return Object.entries(where ?? {}).map(([path, raw]) => [path.split("."), normaliseShibari(raw)]);
}

/** True when the fact's `object` matches every path's filter. An empty `where` always matches. */
function factMatchesWhere(fact: TQuad, where: [string[], TShibari][]): boolean {
	return where.every(([segments, filter]) => evaluateShibari(navigateValue(fact.object, segments).value, filter));
}

/** Converts a `where` value to a filter. A value that names an operator parses as a filter. Any other value becomes `{ eq }` of the value. */
function normaliseShibari(raw: unknown): TShibari {
	return raw && typeof raw === "object" && !Array.isArray(raw) && SHIBARI_OPERATORS.some((op) => op in raw) ? ShibariSchema.parse(raw) : { eq: raw };
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
	if (typeof a !== "object" || typeof b !== "object") return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
	const ak = Object.keys(a);
	if (ak.length !== Object.keys(b).length) return false;
	return ak.every((k) => deepEqual(Reflect.get(a, k), Reflect.get(b, k)));
}

function compare(a: unknown, b: unknown): number {
	if (typeof a === "number" && typeof b === "number") return a - b;
	if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
	return Number.NaN;
}

function dedupe<T>(items: T[]): T[] {
	return [...new Set(items)];
}
