// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseAffordanceProduct } from "./affordances.js";
import { SHU_TYPE } from "../../domains/elements.js";
import { HYPERMEDIA } from "@haibun/core/lib/domains/protocol.js";
import MonitorStepper from "../../monitor-stepper.js";
import ShuStepper from "../../shu-stepper.js";

describe("parseAffordanceProduct", () => {
	it("returns kind:none for an empty product", () => {
		expect(parseAffordanceProduct(undefined)).toEqual({ kind: "none" });
		expect(parseAffordanceProduct({})).toEqual({ kind: "none" });
	});

	it("parses a singleton component product with `view` as the id when `id` is absent (e.g. `show graph view`)", () => {
		const product = { [HYPERMEDIA.TYPE]: "view", [HYPERMEDIA.SUMMARY]: "Graph view", _component: "shu-polymorphic-graph-view", view: "graph" };
		expect(parseAffordanceProduct(product)).toEqual({ kind: "open-component", view: "graph", component: "shu-polymorphic-graph-view", label: "Graph view", products: product });
	});

	it("uses `id` when both `id` and `view` are present (per-instance components)", () => {
		const product = {
			[HYPERMEDIA.TYPE]: "x-clustered-viewer",
			[HYPERMEDIA.SUMMARY]: "Clustered 3D view",
			_component: "x-clustered-viewer",
			id: "x-clustered-viewer:abc-123",
			view: "x-clustered-viewer:abc-123",
		};
		expect(parseAffordanceProduct(product)).toEqual({
			kind: "open-component",
			view: "x-clustered-viewer:abc-123",
			component: "x-clustered-viewer",
			label: "Clustered 3D view",
			products: product,
		});
	});

	it("parses a view-collection product (`show views`)", () => {
		const product = {
			[HYPERMEDIA.TYPE]: SHU_TYPE.VIEW_COLLECTION,
			[HYPERMEDIA.SUMMARY]: "Available Views",
			view: "views",
			views: [
				{ id: "graph", description: "Graph view", component: "shu-polymorphic-graph-view" },
				{ id: "monitor", description: "Monitor", component: "shu-monitor-column" },
			],
		};
		const action = parseAffordanceProduct(product);
		expect(action.kind).toBe("show-views");
		if (action.kind !== "show-views") return;
		expect(action.label).toBe("Available Views");
		expect(action.views).toHaveLength(2);
		expect(action.views[0]).toEqual({ id: "graph", description: "Graph view", component: "shu-polymorphic-graph-view" });
	});

	it("returns kind:none for a bare individual, since its type and id don't name a view to open", () => {
		// Every projected record holds a type and an id. Reading them as an instruction would open a column for every step
		// that returns a record, including each read a view makes to render itself.
		const product = { [HYPERMEDIA.TYPE]: "Email", id: "email-42", [HYPERMEDIA.SUMMARY]: "Inbox: Subject" };
		expect(parseAffordanceProduct(product)).toEqual({ kind: "none" });
	});

	it("rejects a component product that doesn't have `id` or `view`", () => {
		const product = { [HYPERMEDIA.TYPE]: "view", _component: "shu-polymorphic-graph-view" };
		expect(() => parseAffordanceProduct(product)).toThrow(/requires string id or view/);
	});

	it("unwraps a `{ products: <affordance> }` envelope", () => {
		const inner = { [HYPERMEDIA.TYPE]: "view", [HYPERMEDIA.SUMMARY]: "Graph view", _component: "shu-polymorphic-graph-view", view: "graph" };
		const product = { products: inner };
		expect(parseAffordanceProduct(product)).toEqual({ kind: "open-component", view: "graph", component: "shu-polymorphic-graph-view", label: "Graph view", products: inner });
	});
});

/**
 * Checks that the listed view-opening `show` steps of MonitorStepper and ShuStepper declare a `productsDomain`. A
 * per-instance product parses through the same path as a singleton product, so one parser path parses the products of
 * built-in and external views. The SPA opens a component view from a step's products only where they parse to an
 * `open-component` action. A new `show` step is checked only after it is added to `cases`.
 */
describe("show* steps declare the productsDomain whose ui.component names their view's component", () => {
	const stepper = new MonitorStepper();
	const shu = new ShuStepper();

	// The step's action returns plain `{}` products. augmentViewHypermedia adds the hypermedia markers from the domain's
	// `ui` declaration. It adds `_component`, `id` and `view` only for a domain that declares `ui.component`. These cases
	// check the `productsDomain` of each step definition.
	const cases: Array<{ name: string; productsDomain: string; steps: Record<string, unknown> }> = [
		{ name: "showPolymorphicGraphView", productsDomain: "shu-polymorphic-graph-view", steps: shu.steps },
		{ name: "showMonitor", productsDomain: "shu-monitor-column", steps: stepper.steps },
		{ name: "showDocument", productsDomain: "shu-document-column", steps: stepper.steps },
	];

	for (const { name, productsDomain, steps } of cases) {
		it(`${name} declares productsDomain "${productsDomain}"`, () => {
			const step = steps[name] as { productsDomain?: string };
			expect(step.productsDomain).toBe(productsDomain);
		});
	}

	it("a per-instance product with `id = <component>:<uuid>` parses through the same path", () => {
		const product = {
			[HYPERMEDIA.TYPE]: "x-clustered-viewer",
			[HYPERMEDIA.SUMMARY]: "Clustered 3D view",
			_component: "x-clustered-viewer",
			id: "x-clustered-viewer:abc-123",
			view: "x-clustered-viewer:abc-123",
		};
		expect(parseAffordanceProduct(product)).toEqual({
			kind: "open-component",
			view: "x-clustered-viewer:abc-123",
			component: "x-clustered-viewer",
			label: "Clustered 3D view",
			products: product,
		});
	});
});
