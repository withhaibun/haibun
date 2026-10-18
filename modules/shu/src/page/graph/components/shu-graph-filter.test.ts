// @vitest-environment jsdom
// The filter's two host modes: the main graph's legend: its groups of chips (types, properties) plus the instance-data
// controls: and a schema-scoped host (data-schema-only, the class browser) carrying only the Class + Property chips
// with an independent persistence scope. Chips are rendered by <shu-chip-group>, so a chip is one shadow deeper.
import { SHU_TEST_IDS } from "../../../domains/test-ids.js";
import { CLASS_LABEL, PROPERTY_LABEL } from "@haibun/core/lib/resources.js";
import { SHU_EVENT } from "../../../domains/elements.js";
import { describe, it, expect, beforeEach } from "vitest";
import { MAIN_GRAPH_SCOPE, ShuGraphFilter } from "./shu-graph-filter.js";
import { declareSpec } from "../../../test/catalog-fixture.js";
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import "./shu-chip-group.js";
import { COUNT_CEILING, statedTotal } from "@haibun/core/lib/domains/hypermedia.js";

const cluster = (type: string): TCluster => ({ type, totalCount: 2, sampledCount: 2, omittedCount: 0, sampledSubjects: [`${type}-1`, `${type}-2`], displayLabels: {} });

const CLUSTERS = new Map<string, TCluster>([
	["Email", cluster("Email")],
	[CLASS_LABEL, cluster(CLASS_LABEL)],
	[PROPERTY_LABEL, cluster(PROPERTY_LABEL)],
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

async function mount(schemaOnly: boolean, clusters: Map<string, TCluster> = CLUSTERS): Promise<ShuGraphFilter> {
	const el = document.createElement("shu-graph-filter") as ShuGraphFilter;
	if (schemaOnly) {
		el.setAttribute("data-schema-only", "");
		el.dataset.persistScope = "class-browser";
	}
	el.setAttribute("show-controls", "");
	document.body.appendChild(el);
	el.setSource(clusters, QUADS);
	await flush();
	return el;
}

describe("shu-graph-filter host modes", () => {
	beforeEach(() => {
		// The filter draws after the page reads actuality's steps.
		declareSpec({ types: [] });
		document.body.innerHTML = "";
	});

	it("the legend groups the data types apart from the properties, with the instance-data controls", async () => {
		const el = await mount(false);
		expect(chipsOf(el, "types")).toContain("Email");
		// The schema terms are not type chips: they reveal through the one classes & predicates toggle.
		expect(chipsOf(el, "types")).not.toContain(CLASS_LABEL);
		expect(el.shadowRoot?.querySelector(`[data-testid='${SHU_TEST_IDS.GRAPH_FILTER.SCHEMA}']`)).not.toBeNull();
		// A property chip stands for the edges of one predicate: the typed references in the data.
		expect(chipsOf(el, "properties")).toEqual(["inReplyTo", "references"]);
		expect(el.shadowRoot?.querySelector(`[data-testid='${SHU_TEST_IDS.GRAPH_FILTER.LIMIT_VALUE}']`)).not.toBeNull();
		expect(el.shadowRoot?.querySelector(`[data-testid='${SHU_TEST_IDS.GRAPH_FILTER.SOLO}']`)).not.toBeNull();
	});

	it("un-ticking a property reports its predicate as hidden, so a host drops those edges", async () => {
		const el = await mount(false);
		let detail: { hiddenPredicates?: string[] } | undefined;
		el.addEventListener(SHU_EVENT.GRAPH_FILTER_CHANGE, ((e: CustomEvent) => {
			detail = e.detail;
		}) as EventListener);
		el.setPredicateVisibility(["inReplyTo"], false);
		expect(detail?.hiddenPredicates).toEqual(["inReplyTo"]);
		el.setPredicateVisibility(["inReplyTo"], true);
		expect(detail?.hiddenPredicates).toEqual([]);
	});

	it("soloing a SHOWN type leaves it shown: the solo tool acts on the tick, it does not also hide what it soloed", async () => {
		const el = await mount(false);
		const emailBox = (): HTMLInputElement => {
			const group = Array.from(el.shadowRoot?.querySelectorAll("shu-chip-group") ?? []).find((g) => g.getAttribute("name") === "types");
			const chip = Array.from(group?.shadowRoot?.querySelectorAll("label.chip") ?? []).find((l) => (l.textContent ?? "").trim().startsWith("Email"));
			const box = chip?.querySelector("input");
			if (!box) throw new Error("the filter doesn't render an Email type chip to solo");
			return box as HTMLInputElement;
		};
		expect(emailBox().checked).toBe(true); // shown to begin with: the case that broke
		const solo = el.shadowRoot?.querySelector(`[data-testid='${SHU_TEST_IDS.GRAPH_FILTER.SOLO}']`) as HTMLButtonElement | null;
		if (!solo) throw new Error("the filter doesn't render a solo tool to select");
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
		el.addEventListener(SHU_EVENT.GRAPH_FILTER_CHANGE, ((e: CustomEvent) => {
			detail = e.detail;
		}) as EventListener);
		const solo = el.shadowRoot?.querySelector(`[data-testid='${SHU_TEST_IDS.GRAPH_FILTER.SOLO}']`) as HTMLButtonElement | null;
		if (!solo) throw new Error("the filter doesn't render a solo tool to select");
		solo.click();
		await flush();
		const group = Array.from(el.shadowRoot?.querySelectorAll("shu-chip-group") ?? []).find((g) => g.getAttribute("name") === "properties");
		const chip = Array.from(group?.shadowRoot?.querySelectorAll("label.chip") ?? []).find((l) => (l.textContent ?? "").trim().startsWith("inReplyTo"));
		const box = chip?.querySelector("input") as HTMLInputElement | undefined;
		if (!box) throw new Error("the filter doesn't render an inReplyTo property chip to solo");
		box.click();
		await flush();
		expect(detail?.hiddenPredicates, "only the soloed predicate keeps its edges").toEqual(["references"]);
		expect(box.checked, "the soloed property stays shown").toBe(true);
	});

	it("a schema-only host offers ONLY the Class + Property chips and doesn't offer instance-data controls", async () => {
		const el = await mount(true);
		expect(chipsOf(el).sort()).toEqual([CLASS_LABEL, PROPERTY_LABEL]);
		expect(el.shadowRoot?.querySelector(`[data-testid='${SHU_TEST_IDS.GRAPH_FILTER.LIMIT_VALUE}']`)).toBeNull();
		expect(el.shadowRoot?.querySelector(`[data-testid='${SHU_TEST_IDS.GRAPH_FILTER.SOLO}']`)).toBeNull();
	});

	it("a scoped host persists under its own key, never the shared one", () => {
		// The static read is per scope: the shared store and the class browser's store are independent.
		const shared = ShuGraphFilter.getPersistedFilter(MAIN_GRAPH_SCOPE);
		const scoped = ShuGraphFilter.getPersistedFilter("class-browser");
		expect(shared).toBeDefined();
		expect(scoped).toBeDefined();
		// Both start from the initial state here; the contract under test is that the keys differ (persistKey honors the scope).
		const el = document.createElement("shu-graph-filter") as ShuGraphFilter;
		el.dataset.persistScope = "class-browser";
		expect((el as unknown as { persistKey: string }).persistKey).toBe("class-browser");
		const plain = document.createElement("shu-graph-filter") as ShuGraphFilter;
		expect((plain as unknown as { persistKey: string }).persistKey).toBe(MAIN_GRAPH_SCOPE);
	});
});

describe("a type chip's count", () => {
	beforeEach(() => {
		// The filter draws after the page reads actuality's steps.
		declareSpec({ types: [] });
		document.body.innerHTML = "";
	});

	it("states a count that stopped at its ceiling as a floor", async () => {
		const saturated: TCluster = { ...cluster("Email"), totalCount: COUNT_CEILING, sampledCount: 2, omittedCount: COUNT_CEILING - 2, saturated: true };
		const el = await mount(false, new Map([["Email", saturated]]));
		const group = Array.from(el.shadowRoot?.querySelectorAll("shu-chip-group") ?? []).find((g) => g.getAttribute("name") === "types");
		const count = group?.shadowRoot?.querySelector("label.chip .count")?.textContent;
		expect(count).toBe(`(${statedTotal({ total: COUNT_CEILING, saturated: true })})`);
	});
});
