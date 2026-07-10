// @vitest-environment jsdom
// The filter's two host modes: the main graph's full legend, and a schema-scoped host (data-schema-only, the class
// browser) whose legend carries only the Class + Property chips with an independent persistence scope.
import { describe, it, expect, beforeEach } from "vitest";
import { ShuGraphFilter } from "./shu-graph-filter.js";
import { ONTOLOGY_CLASS, ONTOLOGY_PROPERTY } from "../graph/ontology-projection.js";
import type { TCluster } from "@haibun/core/lib/quad-types.js";

const cluster = (type: string): TCluster => ({ type, totalCount: 2, sampledCount: 2, omittedCount: 0, sampledSubjects: [`${type}-1`, `${type}-2`], displayLabels: {} });

const CLUSTERS = new Map<string, TCluster>([
	["Email", cluster("Email")],
	[ONTOLOGY_CLASS, cluster(ONTOLOGY_CLASS)],
	[ONTOLOGY_PROPERTY, cluster(ONTOLOGY_PROPERTY)],
]);

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

async function mount(schemaOnly: boolean): Promise<ShuGraphFilter> {
	const el = document.createElement("shu-graph-filter") as ShuGraphFilter;
	if (schemaOnly) {
		el.setAttribute("data-schema-only", "");
		el.dataset.persistScope = "class-browser";
	}
	el.setAttribute("show-controls", "");
	document.body.appendChild(el);
	el.setSource(CLUSTERS, []);
	await flush();
	return el;
}

describe("shu-graph-filter host modes", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		if (!customElements.get("shu-graph-filter")) customElements.define("shu-graph-filter", ShuGraphFilter);
	});

	it("the full legend offers every type plus the instance-data controls", async () => {
		const el = await mount(false);
		const chips = Array.from(el.shadowRoot?.querySelectorAll("label.type") ?? []).map((c) => c.textContent?.trim().split(" ")[0]);
		expect(chips).toContain("Email");
		expect(chips).toContain(ONTOLOGY_CLASS);
		expect(el.shadowRoot?.querySelector("[data-testid='graph-filter-limit-value']")).not.toBeNull();
		expect(el.shadowRoot?.querySelector("[data-testid='graph-filter-solo']")).not.toBeNull();
	});

	it("a schema-only host offers ONLY the Class + Property chips and no instance-data controls", async () => {
		const el = await mount(true);
		const chips = Array.from(el.shadowRoot?.querySelectorAll("label.type") ?? []).map((c) => c.textContent?.trim().split(" ")[0]);
		expect(chips.sort()).toEqual([ONTOLOGY_CLASS, ONTOLOGY_PROPERTY]);
		expect(el.shadowRoot?.querySelector("[data-testid='graph-filter-limit-value']")).toBeNull();
		expect(el.shadowRoot?.querySelector("[data-testid='graph-filter-solo']")).toBeNull();
	});

	it("a scoped host persists under its own key, never the shared one", () => {
		// The static read is per scope: the shared store and the class browser's store are independent.
		const shared = ShuGraphFilter.getPersistedFilter();
		const scoped = ShuGraphFilter.getPersistedFilter("class-browser");
		expect(shared).toBeDefined();
		expect(scoped).toBeDefined();
		// Both start from defaults here; the contract under test is that the keys differ (persistKey honors the scope).
		const el = document.createElement("shu-graph-filter") as ShuGraphFilter;
		el.dataset.persistScope = "class-browser";
		expect((el as unknown as { persistKey: string }).persistKey).toBe("class-browser");
		const plain = document.createElement("shu-graph-filter") as ShuGraphFilter;
		expect((plain as unknown as { persistKey: string }).persistKey).toBe("");
	});
});
