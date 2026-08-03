// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { harvestChatViewLd } from "./chat-context-harvest.js";
import { activePane } from "./signals.js";

type TView = HTMLElement & { summarizeForKihan(): unknown | null };

/** A duck-typed view: the harvester recognises the method, never the class (cross-bundle identity). */
function view(tag: string, summary: unknown | null): TView {
	const el = document.createElement(tag) as TView;
	el.summarizeForKihan = () => summary;
	return el;
}

/** A pane whose `label` doubles as its columnKey (its identity in the `activePane` signal), so a test marks it active
 *  by `activePane.set(label)` — the one source of truth the harvester reads, mirroring the real strip. */
function pane(label: string | null, ...children: Element[]): HTMLElement {
	const p = document.createElement("shu-column-pane");
	if (label) {
		p.setAttribute("label", label);
		p.dataset.columnKey = label;
	}
	for (const c of children) p.appendChild(c);
	return p;
}

describe("harvestChatViewLd — the active pane's linked data plus the pane manifest", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		activePane.set(null);
	});

	function mount(...panes: HTMLElement[]): void {
		const strip = document.createElement("shu-column-strip");
		for (const p of panes) strip.appendChild(p);
		document.body.appendChild(strip);
	}

	it("harvests the pane marked [active] — never a positional index — and appends the manifest of every pane", () => {
		const a = pane("first", view("shu-entity-column", { "@id": "e1" }));
		const b = pane("second", view("shu-document-column", { "@id": "d1" }));
		activePane.set("second");
		mount(a, b);
		const blocks = harvestChatViewLd();
		expect(blocks[0]).toEqual({ "@id": "d1" });
		const manifest = blocks.at(-1) as { "@type": string; totalItems: number; items: Array<{ name: string; component: string; active: boolean }> };
		expect(manifest["@type"]).toBe("as:Collection");
		expect(manifest.totalItems).toBe(2);
		expect(manifest.items).toEqual([
			{ name: "first", component: "shu-entity-column", active: false },
			{ name: "second", component: "shu-document-column", active: true },
		]);
	});

	it("finds a view nested inside a wrapper, and takes only the top-most summarizer of a composite view", () => {
		const inner = view("shu-graph-scene", { "@id": "scene" });
		const host = view("shu-fisheye-graph-view", { "@id": "graph" });
		host.appendChild(inner);
		const wrapper = document.createElement("div");
		wrapper.appendChild(host);
		const p = pane("graph", wrapper);
		activePane.set("graph");
		mount(p);
		const blocks = harvestChatViewLd();
		// The host's summary only — the nested scene is the host's own concern.
		expect(blocks.filter((b) => (b as { "@id"?: string })["@id"] === "graph")).toHaveLength(1);
		expect(blocks.filter((b) => (b as { "@id"?: string })["@id"] === "scene")).toHaveLength(0);
	});

	it("a null summary contributes nothing; the manifest still lists the pane", () => {
		const p = pane("controls", view("shu-views-picker", null));
		activePane.set("controls");
		mount(p);
		const blocks = harvestChatViewLd();
		expect(blocks).toHaveLength(1); // manifest only
		expect((blocks[0] as { items: unknown[] }).items).toHaveLength(1);
	});

	it("returns empty with no strip mounted", () => {
		expect(harvestChatViewLd()).toEqual([]);
	});
});

/**
 * Reported: the Ask pane says nothing is selected while a column view is plainly selected on screen.
 *
 * The harvester resolves the active pane by matching `activePane` against each pane's key. When the signal holds a key
 * no open pane has — never set for this strip, or naming a pane that has since closed — nothing matches. Harvesting
 * anyway produced a manifest with every pane inactive and no content, which is what the model reported. With panes
 * open one of them is the pane you are on, so this is a fault in the signal and it says so, naming what it holds and
 * what was open.
 */
describe("harvestChatViewLd — an active pane the signal cannot resolve", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		activePane.set(null);
	});

	function mount(...panes: HTMLElement[]): void {
		const strip = document.createElement("shu-column-strip");
		for (const p of panes) strip.appendChild(p);
		document.body.appendChild(strip);
	}

	it("names the signal's value and every open pane's key when it matches none of them", () => {
		const a = pane("first", view("shu-entity-column", { "@id": "e1" }));
		const b = pane("second", view("shu-document-column", { "@id": "d1" }));
		// A pane that was closed, or a key from a previous strip: it matches nothing now.
		activePane.set("a-pane-that-closed");
		mount(a, b);
		// Detail enough to find the writer that set it: what it holds, and what was open.
		expect(() => harvestChatViewLd()).toThrow(/"a-pane-that-closed".*none of the 2 open pane\(s\).*"first", "second"/s);
	});

	it("throws when the signal was never set, rather than telling a model nothing is selected", () => {
		mount(pane("first", view("shu-entity-column", { "@id": "e1" })));
		expect(() => harvestChatViewLd()).toThrow(/activePane is null/);
	});
});
