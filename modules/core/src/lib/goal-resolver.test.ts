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
		expect(result).toMatchObject({ finding: GOAL_FINDING.SATISFIED, goal: "b", factIdentity: "fact-1" });
	});

	it("returns unreachable when no producer exists", () => {
		const result = resolveGoal("z", inputs(emptyGraph()));
		expect(result.finding).toBe(GOAL_FINDING.UNREACHABLE);
		if (result.finding === GOAL_FINDING.UNREACHABLE) expect(result.missing).toContain("z");
	});

	it("returns a plan when a producer chain exists from current facts", () => {
		const graph = singleProducerGraph("a", "b");
		const fact: TQuad = { subject: "fact-1", predicate: "a", object: { id: "x" }, namedGraph: "facts", timestamp: 1 };
		const result = resolveGoal("b", inputs(graph, [fact]));
		expect(result.finding).toBe(GOAL_FINDING.PLAN);
		if (result.finding === GOAL_FINDING.PLAN) {
			expect(result.steps.map((s) => s.stepName)).toEqual(["make"]);
			expect(result.assumes).toEqual([{ domain: "a", identity: "fact-1" }]);
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
		expect(result.finding).toBe(GOAL_FINDING.PLAN);
	});

	it("refuses when the capability set is missing entirely", () => {
		const graph = singleProducerGraph("a", "b");
		const noCapsInputs = { graph, facts: [], capabilities: undefined as unknown as ReadonlySet<string> };
		const result = resolveGoal("b", noCapsInputs);
		expect(result.finding).toBe(GOAL_FINDING.REFUSED);
		if (result.finding === GOAL_FINDING.REFUSED) expect(result.refusalReason).toBe(REFUSAL_REASON.CAPABILITY_CONTEXT_REQUIRED);
	});
});
