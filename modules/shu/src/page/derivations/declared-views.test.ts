import { describe, expect, it } from "vitest";
import { SHU_TAG } from "../../domains/elements.js";
import { declaredViews } from "./declared-views.js";

describe("the views the domains declare", () => {
	it("lists each domain that names a component, by its type where it is persisted, and leaves out the picker that lists them", () => {
		const domains = {
			"graph-axioms": { description: "the axioms of a graph view", ui: { component: SHU_TAG.GRAPH_SOURCE } },
			email: { description: "a message", persistedAs: "Email", ui: { component: "muskeg-email" } },
			text: { description: "free text" },
			[SHU_TAG.VIEWS_PICKER]: { description: "the views", ui: { component: SHU_TAG.VIEWS_PICKER } },
		};
		expect(declaredViews(domains, SHU_TAG.VIEWS_PICKER)).toEqual([
			{ id: "graph-axioms", description: "the axioms of a graph view", component: SHU_TAG.GRAPH_SOURCE },
			{ id: "Email", description: "a message", component: "muskeg-email" },
		]);
	});
});
