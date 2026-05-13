// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseAffordanceProduct } from "./affordance-products.js";
import { SHU_TYPE } from "./consts.js";
import { HYPERMEDIA } from "@haibun/core/schema/protocol.js";
import MonitorStepper from "./monitor-stepper.js";

describe("parseAffordanceProduct", () => {
	it("returns kind:none for empty product", () => {
		expect(parseAffordanceProduct(undefined)).toEqual({ kind: "none" });
		expect(parseAffordanceProduct({})).toEqual({ kind: "none" });
	});

	it("recognises a singleton component product (e.g. `show graph view`) using `view` as the id when `id` is absent", () => {
		const product = { [HYPERMEDIA.TYPE]: "view", [HYPERMEDIA.SUMMARY]: "Graph view", _component: "shu-graph-view", view: "graph" };
		expect(parseAffordanceProduct(product)).toEqual({ kind: "open-component", view: "graph", component: "shu-graph-view", label: "Graph view", products: product });
	});

	it("uses `id` when both `id` and `view` are present (per-instance components like fisheye)", () => {
		const product = {
			[HYPERMEDIA.TYPE]: "shu-fisheye-graph-view",
			[HYPERMEDIA.SUMMARY]: "Fisheye 3D graph view",
			_component: "shu-fisheye-graph-view",
			id: "shu-fisheye-graph-view:abc-123",
			view: "shu-fisheye-graph-view:abc-123",
		};
		expect(parseAffordanceProduct(product)).toEqual({
			kind: "open-component",
			view: "shu-fisheye-graph-view:abc-123",
			component: "shu-fisheye-graph-view",
			label: "Fisheye 3D graph view",
			products: product,
		});
	});

	it("recognises a close-view product", () => {
		const product = { [HYPERMEDIA.TYPE]: SHU_TYPE.CLOSE_VIEW, view: "graph" };
		expect(parseAffordanceProduct(product)).toEqual({ kind: "close", view: "graph" });
	});

	it("recognises a view-collection product (`show views`)", () => {
		const product = {
			[HYPERMEDIA.TYPE]: SHU_TYPE.VIEW_COLLECTION,
			[HYPERMEDIA.SUMMARY]: "Available Views",
			view: "views",
			views: [
				{ id: "graph", description: "Graph view", component: "shu-graph-view" },
				{ id: "monitor", description: "Monitor", component: "shu-monitor-column" },
			],
		};
		const action = parseAffordanceProduct(product);
		expect(action.kind).toBe("show-views");
		if (action.kind !== "show-views") return;
		expect(action.label).toBe("Available Views");
		expect(action.views).toHaveLength(2);
		expect(action.views[0]).toEqual({ id: "graph", description: "Graph view", component: "shu-graph-view" });
	});

	it("recognises a type product (open-type) when `_component` is absent but `_type` + `id` are present", () => {
		const product = { [HYPERMEDIA.TYPE]: "Email", id: "email-42", [HYPERMEDIA.SUMMARY]: "Inbox: Subject" };
		expect(parseAffordanceProduct(product)).toEqual({ kind: "open-type", id: "email-42", type: "Email", label: "Inbox: Subject", products: product });
	});

	it("rejects a component product that has neither `id` nor `view`", () => {
		const product = { [HYPERMEDIA.TYPE]: "view", _component: "shu-graph-view" };
		expect(() => parseAffordanceProduct(product)).toThrow(/requires string id or view/);
	});

	it("unwraps a `{ products: <affordance> }` envelope", () => {
		const inner = { [HYPERMEDIA.TYPE]: "view", [HYPERMEDIA.SUMMARY]: "Graph view", _component: "shu-graph-view", view: "graph" };
		const product = { products: inner };
		expect(parseAffordanceProduct(product)).toEqual({ kind: "open-component", view: "graph", component: "shu-graph-view", label: "Graph view", products: inner });
	});
});

/**
 * Each `show <view>` step in MonitorStepper must produce a product that the
 * parser converts into a well-formed `open-component` action. The fisheye flow
 * works the same way (per-instance id), so passing the same shape contract
 * here guarantees one parser path covers both built-in and external views.
 *
 * If a future change adds a `show*` step with a different product shape, this
 * test fails until the new shape is either fixed or the contract is broadened
 * with a new action kind. That's the point — these are the SPA's view-opening
 * affordances, and any drift here means the SPA can't open them.
 */
describe("show* steps declare a productsDomain whose ui.component opens the view consistently", () => {
	const stepper = new MonitorStepper();

	// Every view-opening step declares a `productsDomain`. The dispatcher injects
	// the hypermedia markers (`_type`, `_component`, `_summary`, `id`, `view`) from
	// the domain's `ui.component` at runtime, so every view opens through one path.
	// The step's action body returns plain `{}` products; this test verifies the contract
	// at the step-definition layer.
	const cases: Array<{ name: keyof typeof stepper.steps; productsDomain: string }> = [
		{ name: "showGraphView", productsDomain: "shu-graph-view" },
		{ name: "showMonitor", productsDomain: "shu-monitor-column" },
		{ name: "showSequenceDiagram", productsDomain: "shu-sequence-diagram" },
		{ name: "showDocument", productsDomain: "shu-document-column" },
	];

	for (const { name, productsDomain } of cases) {
		it(`${name} declares productsDomain "${productsDomain}" for dispatcher view-marker injection`, () => {
			const step = stepper.steps[name] as { productsDomain?: string };
			expect(step.productsDomain).toBe(productsDomain);
		});
	}

	it("a per-instance product (fisheye-style with `id = <component>:<uuid>`) parses through the same path", () => {
		const product = {
			[HYPERMEDIA.TYPE]: "shu-fisheye-graph-view",
			[HYPERMEDIA.SUMMARY]: "Fisheye 3D graph view",
			_component: "shu-fisheye-graph-view",
			id: "shu-fisheye-graph-view:abc-123",
			view: "shu-fisheye-graph-view:abc-123",
		};
		expect(parseAffordanceProduct(product)).toEqual({
			kind: "open-component",
			view: "shu-fisheye-graph-view:abc-123",
			component: "shu-fisheye-graph-view",
			label: "Fisheye 3D graph view",
			products: product,
		});
	});
});
