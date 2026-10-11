// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { harvestChatViewLd } from "./context-harvest.js";
import { activePane } from "../../root.js";

type TView = HTMLElement & { summarizeForContext(): unknown | null };

/** A duck-typed view. The harvester checks for the method and not the class, since each bundle defines its own classes. */
function view(tag: string, summary: unknown | null): TView {
	const el = document.createElement(tag) as TView;
	el.summarizeForContext = () => summary;
	return el;
}

/** A pane whose `label` is also its columnKey. The `activePane` signal holds a pane's columnKey, so a test marks the pane
 *  active by `activePane.set(label)`. The harvester reads the active pane from that signal alone, as with the real strip. */
function pane(label: string | null, ...children: Element[]): HTMLElement {
	const p = document.createElement("shu-column-pane");
	if (label) {
		p.setAttribute("label", label);
		p.dataset.columnKey = label;
	}
	for (const c of children) p.appendChild(c);
	return p;
}

describe("harvestChatViewLd: the active pane's linked data plus the pane manifest", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		activePane.set(null);
	});

	function mount(...panes: HTMLElement[]): void {
		const strip = document.createElement("shu-column-strip");
		for (const p of panes) strip.appendChild(p);
		document.body.appendChild(strip);
	}

	it("harvests the pane the activePane signal names, not a pane by position, and appends the manifest of every pane", () => {
		const a = pane("first", view("shu-entity-column", { "@id": "e1" }));
		const b = pane("second", view("shu-document-column", { "@id": "d1" }));
		activePane.set("second");
		mount(a, b);
		const blocks = harvestChatViewLd(document);
		expect(blocks[0]).toEqual({ "@id": "d1" });
		const manifest = blocks.at(-1) as { "@type"?: string; name: string; totalItems: number; items: Array<{ name: string; component: string; active: boolean }> };
		expect(manifest["@type"], "a block a page carries doesn't claim a type, since what it describes isn't persisted").toBeUndefined();
		expect(manifest.name).toContain("every open column in the workspace");
		expect(manifest.totalItems).toBe(2);
		expect(manifest.items).toEqual([
			{ name: "first", component: "shu-entity-column", active: false },
			{ name: "second", component: "shu-document-column", active: true },
		]);
	});

	it("finds a view nested inside a wrapper, and takes only the top-most summarizer of a composite view", () => {
		const inner = view("shu-graph-scene", { "@id": "scene" });
		const host = view("shu-polymorphic-graph-view", { "@id": "graph" });
		host.appendChild(inner);
		const wrapper = document.createElement("div");
		wrapper.appendChild(host);
		const p = pane("graph", wrapper);
		activePane.set("graph");
		mount(p);
		const blocks = harvestChatViewLd(document);
		// The harvest carries only the host's summary. The host's summary covers its nested scene.
		expect(blocks.filter((b) => (b as { "@id"?: string })["@id"] === "graph")).toHaveLength(1);
		expect(blocks.filter((b) => (b as { "@id"?: string })["@id"] === "scene")).toHaveLength(0);
	});

	it("a null summary doesn't contribute a block; the manifest still lists the pane", () => {
		const p = pane("controls", view("shu-views-picker", null));
		activePane.set("controls");
		mount(p);
		const blocks = harvestChatViewLd(document);
		expect(blocks).toHaveLength(1); // manifest only
		expect((blocks[0] as { items: unknown[] }).items).toHaveLength(1);
	});

	it("omits a pane from the manifest when the reader acts on other views through its view", () => {
		const column = pane("first", view("shu-entity-column", { "@id": "e1" }));
		const actions = Object.assign(pane("Actions", view("shu-actions-bar", null)), { activates: false });
		activePane.set("first");
		mount(column, actions);
		const manifest = harvestChatViewLd(document).at(-1) as { totalItems: number; items: Array<{ name: string }> };
		expect(manifest.items.map((item) => item.name)).toEqual(["first"]);
		expect(manifest.totalItems).toBe(1);
	});

	it("harvests the active pane when the reader acts on other views through it", () => {
		const column = pane("first", view("shu-entity-column", { "@id": "e1" }));
		const actions = Object.assign(pane("Actions", view("shu-actions-bar", { "@id": "a1", exchanges: [{ "@id": "x1" }] })), { activates: false });
		activePane.set("Actions");
		mount(column, actions);
		const blocks = harvestChatViewLd(document);
		// The harvest carries the bar's summary, since the bar's pane is active. The manifest lists only the columns.
		expect(blocks.some((b) => (b as { "@id"?: string })["@id"] === "a1")).toBe(true);
		const manifest = blocks.at(-1) as { totalItems: number; items: Array<{ name: string }> };
		expect(manifest.items.map((item) => item.name)).toEqual(["first"]);
		expect(manifest.totalItems).toBe(1);
	});

	it("returns empty when a strip isn't mounted", () => {
		expect(harvestChatViewLd(document)).toEqual([]);
	});
});

/**
 * Fault case: the Ask pane shows a response stating that a pane isn't selected while a column view is selected on screen.
 *
 * The harvester resolves the active pane by matching `activePane` against each pane's key. The signal can hold a key that
 * doesn't match an open pane: a key never set for this strip, or the key of a closed pane. A harvest with that key would
 * produce a manifest with every pane inactive and without content, and the model's response would state that a pane isn't
 * selected. With panes open, one of them is the active pane. A key that doesn't match one is a fault in the signal, so the
 * harvester throws an error that names the key and the open panes.
 */

describe("harvestChatViewLd: an activePane key that doesn't match an open pane", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		activePane.set(null);
	});

	function mount(...panes: HTMLElement[]): void {
		const strip = document.createElement("shu-column-strip");
		for (const p of panes) strip.appendChild(p);
		document.body.appendChild(strip);
	}

	it("names the signal's value and every open pane's key when it doesn't match one of them", () => {
		const a = pane("first", view("shu-entity-column", { "@id": "e1" }));
		const b = pane("second", view("shu-document-column", { "@id": "d1" }));
		// The key of a closed pane, or a key from a previous strip, doesn't match an open pane.
		activePane.set("a-pane-that-closed");
		mount(a, b);
		// The error names the key and the open panes, so a developer can find the writer that set the key.
		expect(() => harvestChatViewLd(document)).toThrow(/"a-pane-that-closed".*isn't one of the 2 open pane\(s\).*"first", "second"/s);
	});

	it("throws when the signal was never set, so a model's prompt doesn't state that a pane isn't selected", () => {
		mount(pane("first", view("shu-entity-column", { "@id": "e1" })));
		expect(() => harvestChatViewLd(document)).toThrow(/activePane is null/);
	});
});
