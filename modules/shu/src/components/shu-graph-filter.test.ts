// @vitest-environment jsdom
// The filter's two host modes: the main graph's legend: its groups of chips (types, properties) plus the instance-data
// controls: and a schema-scoped host (data-schema-only, the class browser) carrying only the Class + Property chips
// with an independent persistence scope. Chips are rendered by <shu-chip-group>, so a chip lives one shadow deeper.
import { describe, it, expect, beforeEach } from "vitest";
import { ShuGraphFilter } from "./shu-graph-filter.js";
import { ONTOLOGY_CLASS, ONTOLOGY_PROPERTY } from "../graph/ontology-projection.js";
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import "./shu-chip-group.js";

const cluster = (type: string): TCluster => ({ type, totalCount: 2, sampledCount: 2, omittedCount: 0, sampledSubjects: [`${type}-1`, `${type}-2`], displayLabels: {} });

const CLUSTERS = new Map<string, TCluster>([
	["Email", cluster("Email")],
	[ONTOLOGY_CLASS, cluster(ONTOLOGY_CLASS)],
	[ONTOLOGY_PROPERTY, cluster(ONTOLOGY_PROPERTY)],
]);

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

/** One typed reference (objectType present) is one edge, so the properties group offers `inReplyTo`. */
const QUADS: TQuad[] = [
	{ subject: "Email-2", predicate: "inReplyTo", object: "Email-1", objectType: "Email", namedGraph: "Email", timestamp: 1 },
	{ subject: "Email-2", predicate: "references", object: "Email-1", objectType: "Email", namedGraph: "Email", timestamp: 1 },
];

/** Every chip the filter shows, across its groups: the chips render inside <shu-chip-group>'s own shadow root. */
function chipsOf(el: ShuGraphFilter, group?: string): string[] {
	const groups = Array.from(el.shadowRoot?.querySelectorAll("shu-chip-group") ?? []).filter((g) => group === undefined || g.getAttribute("name") === group);
	return groups.flatMap((g) => Array.from(g.shadowRoot?.querySelectorAll("label.chip") ?? []).map((c) => c.textContent?.trim().split(" ")[0] ?? ""));
}

async function mount(schemaOnly: boolean): Promise<ShuGraphFilter> {
	const el = document.createElement("shu-graph-filter") as ShuGraphFilter;
	if (schemaOnly) {
		el.setAttribute("data-schema-only", "");
		el.dataset.persistScope = "class-browser";
	}
	el.setAttribute("show-controls", "");
	document.body.appendChild(el);
	el.setSource(CLUSTERS, QUADS);
	await flush();
	return el;
}

describe("shu-graph-filter host modes", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		if (!customElements.get("shu-graph-filter")) customElements.define("shu-graph-filter", ShuGraphFilter);
	});

	it("the legend groups the data types apart from the properties, with the instance-data controls", async () => {
		const el = await mount(false);
		expect(chipsOf(el, "types")).toContain("Email");
		// The schema terms are not type chips: they reveal through the one classes & predicates toggle.
		expect(chipsOf(el, "types")).not.toContain(ONTOLOGY_CLASS);
		expect(el.shadowRoot?.querySelector("[data-testid='graph-filter-schema']")).not.toBeNull();
		// A property chip stands for the edges of one predicate: the typed references in the data.
		expect(chipsOf(el, "properties")).toEqual(["inReplyTo", "references"]);
		expect(el.shadowRoot?.querySelector("[data-testid='graph-filter-limit-value']")).not.toBeNull();
		expect(el.shadowRoot?.querySelector("[data-testid='graph-filter-solo']")).not.toBeNull();
	});

	it("un-ticking a property reports its predicate as hidden, so a host drops those edges", async () => {
		const el = await mount(false);
		let detail: { hiddenPredicates?: string[] } | undefined;
		el.addEventListener("graph-filter-change", ((e: CustomEvent) => {
			detail = e.detail;
		}) as EventListener);
		el.setPredicateVisibility(["inReplyTo"], false);
		expect(detail?.hiddenPredicates).toEqual(["inReplyTo"]);
		el.setPredicateVisibility(["inReplyTo"], true);
		expect(detail?.hiddenPredicates).toEqual([]);
	});

	it("soloing a SHOWN type leaves it shown: the solo tool answers the tick, it does not also hide what it soloed", async () => {
		const el = await mount(false);
		const emailBox = (): HTMLInputElement => {
			const group = Array.from(el.shadowRoot?.querySelectorAll("shu-chip-group") ?? []).find((g) => g.getAttribute("name") === "types");
			const chip = Array.from(group?.shadowRoot?.querySelectorAll("label.chip") ?? []).find((l) => (l.textContent ?? "").trim().startsWith("Email"));
			const box = chip?.querySelector("input");
			if (!box) throw new Error("no Email type chip to solo");
			return box as HTMLInputElement;
		};
		expect(emailBox().checked).toBe(true); // shown to begin with: the case that broke
		const solo = el.shadowRoot?.querySelector("[data-testid='graph-filter-solo']") as HTMLButtonElement | null;
		if (!solo) throw new Error("no solo tool to arm");
		solo.click();
		await flush();
		emailBox().click(); // press the shown chip: solo it
		await flush();
		expect(emailBox().checked, "the soloed type stays shown").toBe(true);
		expect(chipsOf(el, "types")).toContain("Email");
	});

	it("solo works on a property too: the pressed predicate keeps its edges, every other predicate loses them", async () => {
		const el = await mount(false);
		let detail: { hiddenPredicates?: string[] } | undefined;
		el.addEventListener("graph-filter-change", ((e: CustomEvent) => {
			detail = e.detail;
		}) as EventListener);
		const solo = el.shadowRoot?.querySelector("[data-testid='graph-filter-solo']") as HTMLButtonElement | null;
		if (!solo) throw new Error("no solo tool to arm");
		solo.click();
		await flush();
		const group = Array.from(el.shadowRoot?.querySelectorAll("shu-chip-group") ?? []).find((g) => g.getAttribute("name") === "properties");
		const chip = Array.from(group?.shadowRoot?.querySelectorAll("label.chip") ?? []).find((l) => (l.textContent ?? "").trim().startsWith("inReplyTo"));
		const box = chip?.querySelector("input") as HTMLInputElement | undefined;
		if (!box) throw new Error("no inReplyTo property chip to solo");
		box.click();
		await flush();
		expect(detail?.hiddenPredicates, "only the soloed predicate keeps its edges").toEqual(["references"]);
		expect(box.checked, "the soloed property stays shown").toBe(true);
	});

	it("a schema-only host offers ONLY the Class + Property chips and no instance-data controls", async () => {
		const el = await mount(true);
		expect(chipsOf(el).sort()).toEqual([ONTOLOGY_CLASS, ONTOLOGY_PROPERTY]);
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
