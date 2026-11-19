// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseAffordanceProduct } from "./affordances.js";
import { HYPERMEDIA } from "@haibun/core/lib/domains/protocol.js";
import MonitorStepper from "../../monitor-stepper.js";
import ShuStepper from "../../shu-stepper.js";
import { contractProducts } from "@haibun/core/lib/contract.js";
import type { TStepperStep } from "@haibun/core/lib/astepper.js";

describe("parseAffordanceProduct", () => {
	it("returns kind:none for an empty product", () => {
		expect(parseAffordanceProduct(undefined)).toEqual({ kind: "none" });
		expect(parseAffordanceProduct({})).toEqual({ kind: "none" });
	});

	it("parses a component product, which names its pane in `_view`", () => {
		const product = { [HYPERMEDIA.TYPE]: "view", [HYPERMEDIA.SUMMARY]: "Graph view", [HYPERMEDIA.COMPONENT]: "shu-polymorphic-graph-view", [HYPERMEDIA.VIEW]: "graph" };
		expect(parseAffordanceProduct(product)).toEqual({ kind: "open-component", view: "graph", component: "shu-polymorphic-graph-view", label: "Graph view", products: product });
	});

	it("opens the pane `_view` names, apart from the `id` the product's own data holds", () => {
		const product = { [HYPERMEDIA.COMPONENT]: "shu-entity-column", [HYPERMEDIA.VIEW]: "Email", id: "email-42" };
		expect(parseAffordanceProduct(product)).toMatchObject({ kind: "open-component", view: "Email", component: "shu-entity-column" });
	});

	it("returns kind:none for a bare individual, since its type and id don't name a view to open", () => {
		// Every projected record holds a type and an id. Reading them as an instruction would open a column for every step
		// that returns a record, including each read a view makes to render itself.
		const product = { [HYPERMEDIA.TYPE]: "Email", id: "email-42", [HYPERMEDIA.SUMMARY]: "Inbox: Subject" };
		expect(parseAffordanceProduct(product)).toEqual({ kind: "none" });
	});

	it("refuses a product that states its component or its pane without the other", () => {
		expect(() => parseAffordanceProduct({ [HYPERMEDIA.COMPONENT]: "shu-polymorphic-graph-view" })).toThrow(/states _view alone|states _component alone/);
		expect(() => parseAffordanceProduct({ [HYPERMEDIA.VIEW]: "graph" })).toThrow(/states _view alone/);
	});

	it("unwraps a `{ products: <affordance> }` envelope", () => {
		const inner = { [HYPERMEDIA.TYPE]: "view", [HYPERMEDIA.SUMMARY]: "Graph view", [HYPERMEDIA.COMPONENT]: "shu-polymorphic-graph-view", [HYPERMEDIA.VIEW]: "graph" };
		const product = { products: inner };
		expect(parseAffordanceProduct(product)).toEqual({ kind: "open-component", view: "graph", component: "shu-polymorphic-graph-view", label: "Graph view", products: inner });
	});
});

/**
 * Checks that the listed view-opening `show` steps of MonitorStepper and ShuStepper declare the domain of their products in their contract. A
 * product of a built-in view and of an external view parse through one path. The SPA opens a component view from a step's products only where they parse to an
 * `open-component` action. A new `show` step is checked only after it is added to `cases`.
 */
describe("show* steps declare the products domain whose ui.component names their view's component", () => {
	const stepper = new MonitorStepper();
	const shu = new ShuStepper();

	// The step's action returns plain `{}` products. augmentViewHypermedia adds the hypermedia markers from the domain's
	// `ui` declaration. It adds `_component` and `_view` only for a domain that declares `ui.component`. These cases
	// check the products domain of each step definition's contract.
	const cases: Array<{ name: string; domain: string; steps: Record<string, unknown> }> = [
		{ name: "showPolymorphicGraphView", domain: "shu-polymorphic-graph-view", steps: shu.steps },
		{ name: "showMonitor", domain: "shu-monitor-column", steps: stepper.steps },
		{ name: "showDocument", domain: "shu-document-column", steps: stepper.steps },
	];

	for (const { name, domain, steps } of cases) {
		it(`${name} declares the products domain "${domain}"`, () => {
			expect(contractProducts(steps[name] as TStepperStep).domain).toBe(domain);
		});
	}
});
