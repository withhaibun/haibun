import { describe, it, expect } from "vitest";

import { GOAL_FINDING, REFUSAL_REASON, resolveGoal, type TResolverInputs } from "./goal-resolver.js";
import type { TDomainChainGraph } from "./domain-chain.js";
import type { TQuad } from "./quad-types.js";

function emptyGraph(): TDomainChainGraph {
	return { domains: [], steps: [], edges: [] };
}

function singleProducerGraph(input: string, output: string, capability?: string): TDomainChainGraph {
	return {
		domains: [
			{ key: input, hasTopology: false },
			{ key: output, hasTopology: false },
		],
		steps: [{ stepperName: "S", stepName: "make", gwta: "make it", inputDomains: [input], outputDomains: [output], capability }],
		edges: [{ from: input, to: output, stepperName: "S", stepName: "make" }],
	};
}

function inputs(graph: TDomainChainGraph, facts: TQuad[] = [], capabilities = new Set<string>()): TResolverInputs {
	return { graph, facts, capabilities };
}

describe("resolveGoal", () => {
	it("returns satisfied when a fact of the goal already exists", () => {
		const graph = singleProducerGraph("a", "b");
		const fact: TQuad = { subject: "fact-1", predicate: "b", object: { id: "x" }, namedGraph: "facts", timestamp: 1 };
		const result = resolveGoal("b", inputs(graph, [fact]));
		expect(result).toMatchObject({ finding: GOAL_FINDING.SATISFIED, goal: "b", factIds: ["fact-1"] });
	});

	it("a satisfied goal still surfaces producer paths so the user can run again to produce another instance", () => {
		const graph = singleProducerGraph("a", "b");
		const existingGoalFact: TQuad = { subject: "fact-1", predicate: "b", object: { id: "x" }, namedGraph: "facts", timestamp: 1 };
		const result = resolveGoal("b", inputs(graph, [existingGoalFact]));
		expect(result.finding).toBe(GOAL_FINDING.SATISFIED);
		if (result.finding !== GOAL_FINDING.SATISFIED) throw new Error("unreachable");
		expect(result.factIds).toEqual(["fact-1"]);
		// `b` has a producer step that takes `a` as input; even though `b` is satisfied,
		// the user must still have the option to run the chain again.
		expect(result.michi.length).toBeGreaterThan(0);
		expect(result.michi[0].steps.map((s) => s.stepName)).toEqual(["make"]);
	});

	it("returns satisfied with every matching fact id (multiple facts of the same goal)", () => {
		const graph = singleProducerGraph("a", "b");
		const f1: TQuad = { subject: "fact-1", predicate: "b", object: { id: "x" }, namedGraph: "facts", timestamp: 1 };
		const f2: TQuad = { subject: "fact-2", predicate: "b", object: { id: "y" }, namedGraph: "facts", timestamp: 2 };
		const result = resolveGoal("b", inputs(graph, [f1, f2]));
		expect(result).toMatchObject({ finding: GOAL_FINDING.SATISFIED, factIds: ["fact-1", "fact-2"] });
	});

	it("returns unreachable when no producer exists and goal isn't its own argument leaf", () => {
		// "z" is the goal itself, not an input — and the empty graph has no edges into it.
		const result = resolveGoal("z", inputs(emptyGraph()));
		expect(result.finding).toBe(GOAL_FINDING.UNREACHABLE);
		if (result.finding === GOAL_FINDING.UNREACHABLE) expect(result.missing).toContain("z");
	});

	it("returns michi when a producer chain exists from current facts", () => {
		const graph = singleProducerGraph("a", "b");
		const fact: TQuad = { subject: "fact-1", predicate: "a", object: { id: "x" }, namedGraph: "facts", timestamp: 1 };
		const result = resolveGoal("b", inputs(graph, [fact]));
		expect(result.finding).toBe(GOAL_FINDING.MICHI);
		if (result.finding === GOAL_FINDING.MICHI) {
			expect(result.michi).toHaveLength(1);
			expect(result.michi[0].steps.map((s) => s.stepName)).toEqual(["make"]);
			expect(result.michi[0].bindings).toEqual([{ kind: "fact", domain: "a", factId: "fact-1" }]);
		}
	});

	it("enumerates every distinct chain when multiple producers exist (choose your own adventure)", () => {
		const graph: TDomainChainGraph = {
			domains: [
				{ key: "a", hasTopology: false },
				{ key: "b", hasTopology: false },
			],
			steps: [
				{ stepperName: "S", stepName: "make1", inputDomains: ["a"], outputDomains: ["b"] },
				{ stepperName: "S", stepName: "make2", inputDomains: ["a"], outputDomains: ["b"] },
			],
			edges: [
				{ from: "a", to: "b", stepperName: "S", stepName: "make1" },
				{ from: "a", to: "b", stepperName: "S", stepName: "make2" },
			],
		};
		const fact: TQuad = { subject: "fact-1", predicate: "a", object: { id: "x" }, namedGraph: "facts", timestamp: 1 };
		const result = resolveGoal("b", inputs(graph, [fact]));
		expect(result.finding).toBe(GOAL_FINDING.MICHI);
		if (result.finding === GOAL_FINDING.MICHI) {
			expect(result.michi.map((m) => m.steps[0].stepName).sort()).toEqual(["make1", "make2"]);
		}
	});

	it("filters facts by shibari `where` (value equality)", () => {
		const graph = singleProducerGraph("a", "b");
		const f1: TQuad = { subject: "fact-1", predicate: "b", object: { id: "x", role: "issuer" }, namedGraph: "facts", timestamp: 1 };
		const f2: TQuad = { subject: "fact-2", predicate: "b", object: { id: "y", role: "verifier" }, namedGraph: "facts", timestamp: 2 };
		const result = resolveGoal("b", { graph, facts: [f1, f2], capabilities: new Set(), where: { role: "issuer" } });
		expect(result).toMatchObject({ finding: GOAL_FINDING.SATISFIED, factIds: ["fact-1"] });
	});

	it("a step input with no producer is treated as a user-supplied argument binding", () => {
		// "a" has no producer in the graph — chase treats it as an argument leaf.
		const graph: TDomainChainGraph = {
			domains: [
				{ key: "a", hasTopology: false },
				{ key: "b", hasTopology: false },
			],
			steps: [{ stepperName: "S", stepName: "make", inputDomains: ["a"], outputDomains: ["b"] }],
			edges: [{ from: "a", to: "b", stepperName: "S", stepName: "make" }],
		};
		const result = resolveGoal("b", inputs(graph));
		expect(result.finding).toBe(GOAL_FINDING.MICHI);
		if (result.finding === GOAL_FINDING.MICHI) {
			expect(result.michi[0].bindings).toEqual([{ kind: "argument", domain: "a" }]);
		}
	});

	it("returns unreachable for a 2-cycle (no external producer)", () => {
		const graph: TDomainChainGraph = {
			domains: [
				{ key: "a", hasTopology: false },
				{ key: "b", hasTopology: false },
			],
			steps: [
				{ stepperName: "S", stepName: "p1", inputDomains: ["a"], outputDomains: ["b"] },
				{ stepperName: "S", stepName: "p2", inputDomains: ["b"], outputDomains: ["a"] },
			],
			edges: [
				{ from: "a", to: "b", stepperName: "S", stepName: "p1" },
				{ from: "b", to: "a", stepperName: "S", stepName: "p2" },
			],
		};
		const result = resolveGoal("a", inputs(graph));
		expect(result.finding).toBe(GOAL_FINDING.UNREACHABLE);
	});

	it("respects depth limits without infinite recursion", () => {
		// Long unbroken producer chain longer than the depth limit.
		const stepCount = 12;
		const steps = [];
		const edges = [];
		for (let i = 0; i < stepCount; i++) {
			steps.push({ stepperName: "S", stepName: `s${i}`, inputDomains: [`d${i}`], outputDomains: [`d${i + 1}`] });
			edges.push({ from: `d${i}`, to: `d${i + 1}`, stepperName: "S", stepName: `s${i}` });
		}
		const domains = [];
		for (let i = 0; i <= stepCount; i++) domains.push({ key: `d${i}`, hasTopology: false });
		const graph: TDomainChainGraph = { domains, steps, edges };
		const result = resolveGoal(`d${stepCount}`, { graph, facts: [], capabilities: new Set(), depthLimit: 5 });
		expect(result.finding).toBe(GOAL_FINDING.UNREACHABLE);
	});

	it("filters out producer steps the caller does not have capability for", () => {
		const graph = singleProducerGraph("a", "b", "auth:signin");
		const fact: TQuad = { subject: "fact-1", predicate: "a", object: { id: "x" }, namedGraph: "facts", timestamp: 1 };
		const result = resolveGoal("b", inputs(graph, [fact], new Set([])));
		expect(result.finding).toBe(GOAL_FINDING.UNREACHABLE);
	});

	it("includes the capability-gated step when the caller has the capability", () => {
		const graph = singleProducerGraph("a", "b", "auth:signin");
		const fact: TQuad = { subject: "fact-1", predicate: "a", object: { id: "x" }, namedGraph: "facts", timestamp: 1 };
		const result = resolveGoal("b", inputs(graph, [fact], new Set(["auth:signin"])));
		expect(result.finding).toBe(GOAL_FINDING.MICHI);
	});

	it("refuses when the capability set is missing entirely", () => {
		const graph = singleProducerGraph("a", "b");
		const noCapsInputs = { graph, facts: [], capabilities: undefined as unknown as ReadonlySet<string> };
		const result = resolveGoal("b", noCapsInputs);
		expect(result.finding).toBe(GOAL_FINDING.REFUSED);
		if (result.finding === GOAL_FINDING.REFUSED) expect(result.refusalReason).toBe(REFUSAL_REASON.CAPABILITY_CONTEXT_REQUIRED);
	});
});
