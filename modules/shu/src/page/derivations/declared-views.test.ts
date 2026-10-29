import { describe, expect, it } from "vitest";
import { SHU_TAG } from "../../domains/elements.js";
import { declaredViews } from "./declared-views.js";

const domain = (description: string) => ({ description, isPersisted: false }) as never;
const COMPONENTS: Record<string, string> = { "graph-axioms": SHU_TAG.GRAPH_SOURCE, Email: "muskeg-email", [SHU_TAG.VIEWS_PICKER]: SHU_TAG.VIEWS_PICKER };
const componentOf = (view: string): string => COMPONENTS[view] ?? view;

describe("the views the domains declare", () => {
	it("lists each view the catalog declares with its component and its domain's description, and leaves out the picker that lists them", () => {
		const domains = { "graph-axioms": domain("the axioms of a graph view"), Email: domain("a message"), [SHU_TAG.VIEWS_PICKER]: domain("the views") };
		expect(declaredViews(["graph-axioms", "Email", SHU_TAG.VIEWS_PICKER], componentOf, domains, SHU_TAG.VIEWS_PICKER)).toEqual([
			{ id: "graph-axioms", description: "the axioms of a graph view", component: SHU_TAG.GRAPH_SOURCE },
			{ id: "Email", description: "a message", component: "muskeg-email" },
		]);
	});

	it("refuses a view whose domain actuality doesn't declare", () => {
		expect(() => declaredViews(["ghost"], componentOf, {}, SHU_TAG.VIEWS_PICKER)).toThrow("the catalog declares the view ghost, whose domain actuality doesn't declare");
	});
});
