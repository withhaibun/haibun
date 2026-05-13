import { describe, it, expect } from "vitest";
import type { TMichi } from "@haibun/core/lib/goal-resolver.js";
import { pathId, projectGoalPaths } from "./project-goal-paths.js";

const michiA: TMichi = {
	steps: [
		{ stepperName: "CustomerStepper", stepName: "createCustomer", gwta: "create customer", productsDomain: "customer" },
		{ stepperName: "OrderStepper", stepName: "placeOrder", gwta: "place order", productsDomain: "order" },
	],
	bindings: [{ kind: "argument", domain: "buyer" }],
};
const michiB: TMichi = {
	steps: [{ stepperName: "OrderStepper", stepName: "importOrder", gwta: "import order", productsDomain: "order" }],
	bindings: [],
};

describe("projectGoalPaths", () => {
	it("renders the goal as a single reachable node and connects every path to it", () => {
		const g = projectGoalPaths({ goal: "order", finding: "michi", michi: [michiA, michiB] });
		const goalNode = g.nodes.find((n) => n.id === "goal:order");
		expect(goalNode?.kind).toBe("reachable");
		const incomingToGoal = g.edges.filter((e) => e.to === "goal:order");
		expect(incomingToGoal.length).toBeGreaterThanOrEqual(1);
	});

	it("tags each path's edges with its own pathId so consumers can highlight one path at a time", () => {
		const g = projectGoalPaths({ goal: "order", finding: "michi", michi: [michiA, michiB] });
		const pathAEdges = g.edges.filter((e) => e.paths?.includes(pathId(0)));
		const pathBEdges = g.edges.filter((e) => e.paths?.includes(pathId(1)));
		expect(pathAEdges.length).toBeGreaterThan(0);
		expect(pathBEdges.length).toBeGreaterThan(0);
	});

	it("renders argument bindings as separate `argument`-kind nodes that share between paths if the domain matches", () => {
		const sharedArg: TMichi = { steps: [{ stepperName: "OrderStepper", stepName: "noteOrder", productsDomain: "order" }], bindings: [{ kind: "argument", domain: "buyer" }] };
		const g = projectGoalPaths({ goal: "order", finding: "michi", michi: [michiA, sharedArg] });
		const argNodes = g.nodes.filter((n) => n.kind === "argument" && n.label === "buyer");
		expect(argNodes.length).toBe(1);
	});

	it("flags satisfied goals with the satisfied kind so they render distinctly", () => {
		const g = projectGoalPaths({ goal: "order", finding: "satisfied", michi: [] });
		expect(g.nodes.find((n) => n.id === "goal:order")?.kind).toBe("satisfied");
	});

	it("renders composite bindings as a tree of field nodes connected through the composite to the step", () => {
		const compositeMichi: TMichi = {
			steps: [{ stepperName: "OrderStepper", stepName: "placeOrder", productsDomain: "order" }],
			bindings: [
				{
					kind: "composite",
					domain: "order-input",
					fields: [
						{ fieldName: "customer", fieldDomain: "customer", fieldType: "object", optional: false, kind: "fact", factId: "fact-customer-1" },
						{ fieldName: "note", fieldDomain: "", fieldType: "string", optional: false, kind: "argument" },
					],
				},
			],
		};
		const g = projectGoalPaths({ goal: "order", finding: "michi", michi: [compositeMichi] });
		expect(g.nodes.some((n) => n.id === "composite:order-input")).toBe(true);
		expect(g.nodes.some((n) => n.id === "field:order-input#customer")).toBe(true);
		expect(g.nodes.some((n) => n.id === "field:order-input#note")).toBe(true);
		expect(g.nodes.some((n) => n.id === "fact:customer#fact-customer-1")).toBe(true);
		const customerEdge = g.edges.find((e) => e.from === "fact:customer#fact-customer-1" && e.to === "field:order-input#customer");
		expect(customerEdge).toBeTruthy();
	});

	it("step nodes carry hbn:invoke metadata so a click handler can start a chain", () => {
		const g = projectGoalPaths({ goal: "order", finding: "michi", michi: [michiA] });
		const stepNode = g.nodes.find((n) => n.invokes?.stepperName === "CustomerStepper");
		expect(stepNode?.invokes).toMatchObject({ stepperName: "CustomerStepper", stepName: "createCustomer" });
	});
});
