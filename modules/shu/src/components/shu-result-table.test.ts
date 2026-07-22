// @vitest-environment jsdom
/**
 * shu-result-table rendering and interaction that does not need layout. In jsdom there is no ResizeObserver, so the
 * inner <shu-virtual-column> renders its plain-list fallback (every row), which lets these tests assert the derived
 * columns, row test-ids, selection, group headers, future-dimming, and the sort/row/deselect events. Scroll geometry
 * (thumb, marker jump, O(viewport) window) needs real layout and is covered by shu-scrollbar's tests and the browser e2e.
 */
import { describe, it, expect } from "vitest";
import "./shu-result-table.js"; // side-effect import runs the module so customElements.define registers the element
import type { ShuResultTable } from "./shu-result-table.js";
import { arrayWindowedSource } from "../windowed-source.js";
import { SHU_EVENT } from "../consts.js";

type Row = Record<string, unknown>;

async function mount(): Promise<ShuResultTable> {
	const el = document.createElement("shu-result-table") as ShuResultTable;
	document.body.appendChild(el);
	await el.updateComplete;
	return el;
}

async function settle(el: ShuResultTable): Promise<void> {
	await el.updateComplete;
	const vc = el.shadowRoot?.querySelector("shu-virtual-column") as (HTMLElement & { updateComplete?: Promise<unknown> }) | null;
	if (vc?.updateComplete) await vc.updateComplete;
}

const rows = (n: number, type = "Person"): Row[] => Array.from({ length: n }, (_, i) => ({ "@id": `${type}/${i}`, "@type": type, name: `n${i}`, age: i }));
const q = (el: ShuResultTable, sel: string): Element[] => Array.from(el.shadowRoot?.querySelectorAll(sel) ?? []);
const clickEvents = (el: ShuResultTable, name: string): CustomEvent[] => {
	const seen: CustomEvent[] = [];
	el.addEventListener(name, (e) => seen.push(e as CustomEvent));
	return seen;
};

describe("shu-result-table", () => {
	it("derives visible columns from the rows and renders a header cell per column", async () => {
		const el = await mount();
		el.setResults(rows(3));
		await settle(el);
		const headers = q(el, ".grid-header .th").map((h) => (h.textContent ?? "").trim());
		expect(headers).toEqual(["age", "name"]); // @id/@type hidden, remaining keys sorted
	});

	it("renders one row per result with query-row-first on the first and query-row on the rest", async () => {
		const el = await mount();
		el.setResults(rows(4));
		await settle(el);
		expect(q(el, '[data-testid="query-row-first"]')).toHaveLength(1);
		expect(q(el, '[data-testid="query-row"]')).toHaveLength(3);
		expect(q(el, ".clickable-row")).toHaveLength(4);
	});

	it("shows the total from the source count", async () => {
		const el = await mount();
		el.setResults(rows(7));
		await settle(el);
		expect((el.shadowRoot?.querySelector('[data-testid="query-total"]')?.textContent ?? "").trim()).toBe("7");
	});

	it("selects a row on click, dispatches row-click, and marks it selected", async () => {
		const el = await mount();
		el.setResults(rows(3));
		await settle(el);
		const events = clickEvents(el, SHU_EVENT.ROW_CLICK);
		const firstRow = el.shadowRoot?.querySelector(".clickable-row") as HTMLElement;
		firstRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle(el);
		expect(events).toHaveLength(1);
		expect(events[0].detail.individualId).toBe("0");
		expect(el.getSelectedIds().has("0")).toBe(true);
		expect((el.shadowRoot?.querySelector(".clickable-row") as HTMLElement).classList.contains("selected")).toBe(true);
	});

	it("clicking the only selected row again clears the selection", async () => {
		const el = await mount();
		el.setResults(rows(2));
		await settle(el);
		const row = () => el.shadowRoot?.querySelector(".clickable-row") as HTMLElement;
		row().dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle(el);
		row().dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle(el);
		expect(el.getSelectedIds().size).toBe(0);
	});

	it("ctrl-click adds to the selection instead of replacing it", async () => {
		const el = await mount();
		el.setResults(rows(3));
		await settle(el);
		const items = q(el, ".clickable-row") as HTMLElement[];
		items[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle(el);
		items[1].dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
		await settle(el);
		expect([...el.getSelectedIds()].sort()).toEqual(["0", "1"]);
	});

	it("an empty-area click deselects and dispatches a deselect row-click", async () => {
		const el = await mount();
		el.setResults(rows(2));
		await settle(el);
		(el.shadowRoot?.querySelector(".clickable-row") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle(el);
		const events = clickEvents(el, SHU_EVENT.ROW_CLICK);
		(el.shadowRoot?.querySelector(".results-area") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle(el);
		expect(el.getSelectedIds().size).toBe(0);
		expect(events.at(-1)?.detail.deselect).toBe(true);
	});

	it("a sortable header click dispatches sort-change toggling the order", async () => {
		const el = await mount();
		el.setSortableFields(["name"]);
		el.setResults(rows(2));
		await settle(el);
		const events = clickEvents(el, SHU_EVENT.SORT_CHANGE);
		const nameHeader = q(el, ".grid-header .th").find((h) => (h as HTMLElement).dataset.field === "name") as HTMLElement;
		expect(nameHeader).toBeTruthy();
		nameHeader.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(events).toHaveLength(1);
		expect(events[0].detail).toEqual({ field: "name", order: "asc" });
	});

	it("a non-sortable header is inert", async () => {
		const el = await mount();
		el.setSortableFields([]); // nothing sortable
		el.setResults(rows(2));
		await settle(el);
		const events = clickEvents(el, SHU_EVENT.SORT_CHANGE);
		(q(el, ".grid-header .th")[0] as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(events).toHaveLength(0);
	});

	it("inserts a group header where the @type changes in a multi-type set", async () => {
		const el = await mount();
		el.setResults([...rows(2, "Person"), ...rows(2, "Place")]);
		await settle(el);
		const groups = q(el, ".group-header").map((g) => (g.textContent ?? "").trim());
		expect(groups).toEqual(["Place"]); // one boundary: Person -> Place (the first type gets no header)
	});

	it("shows no group headers for a single-type set", async () => {
		const el = await mount();
		el.setResults(rows(5, "Person"));
		await settle(el);
		expect(q(el, ".group-header")).toHaveLength(0);
	});

	it("drives the same render from an external windowed source", async () => {
		const el = await mount();
		const src = arrayWindowedSource<Row>(rows(3));
		el.setSource(src);
		await settle(el);
		expect(q(el, ".clickable-row")).toHaveLength(3);
		expect((el.shadowRoot?.querySelector('[data-testid="query-total"]')?.textContent ?? "").trim()).toBe("3");
	});

	it("re-renders when the external source appends (a live re-query)", async () => {
		const el = await mount();
		const src = arrayWindowedSource<Row>(rows(2));
		el.setSource(src);
		await settle(el);
		expect(q(el, ".clickable-row")).toHaveLength(2);
		src.set(rows(6));
		await settle(el);
		expect(q(el, ".clickable-row")).toHaveLength(6);
	});
});
