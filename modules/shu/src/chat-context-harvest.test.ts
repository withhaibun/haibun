// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { HARVEST_MEMBERS, harvestChatViewLd, harvested } from "./chat-context-harvest.js";
import { activePane } from "./signals.js";

type TView = HTMLElement & { summarizeForKihan(): unknown | null };

/** A duck-typed view: the harvester recognises the method, never the class (cross-bundle identity). */
function view(tag: string, summary: unknown | null): TView {
	const el = document.createElement(tag) as TView;
	el.summarizeForKihan = () => summary;
	return el;
}

/** A pane whose `label` doubles as its columnKey (its identity in the `activePane` signal), so a test marks it active
 *  by `activePane.set(label)`: the one source of truth the harvester reads, mirroring the real strip. */
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

	it("harvests the pane marked [active], never a positional index, and appends the manifest of every pane", () => {
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
		const host = view("shu-polymorphic-graph-view", { "@id": "graph" });
		host.appendChild(inner);
		const wrapper = document.createElement("div");
		wrapper.appendChild(host);
		const p = pane("graph", wrapper);
		activePane.set("graph");
		mount(p);
		const blocks = harvestChatViewLd();
		// The host's summary only: the nested scene is the host's own concern.
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

	it("leaves out of the manifest a pane whose view the reader acts on other views through", () => {
		const column = pane("first", view("shu-entity-column", { "@id": "e1" }));
		const actions = Object.assign(pane("Actions", view("shu-actions-bar", null)), { activates: false });
		activePane.set("first");
		mount(column, actions);
		const manifest = harvestChatViewLd().at(-1) as { totalItems: number; items: Array<{ name: string }> };
		expect(manifest.items.map((item) => item.name)).toEqual(["first"]);
		expect(manifest.totalItems).toBe(1);
	});

	it("returns empty with no strip mounted", () => {
		expect(harvestChatViewLd()).toEqual([]);
	});
});

/**
 * Reported: the Ask pane says nothing is selected while a column view is plainly selected on screen.
 *
 * The harvester resolves the active pane by matching `activePane` against each pane's key. When the signal holds a key
 * no open pane has, never set for this strip, or naming a pane that has since closed, nothing matches. Harvesting
 * anyway produced a manifest with every pane inactive and no content, which is what the model reported. With panes
 * open one of them is the pane you are on, so this is a fault in the signal and it says so, naming what it holds and
 * what was open.
 */
describe("what a page sends of a view that states many members", () => {
	const members = (count: number, key = "quads") => ({
		"@id": "view:graph",
		"@type": "as:Collection",
		totalItems: count,
		[key]: Array.from({ length: count }, (_, at) => ({ at })),
	});

	it("carries the members the view stated first, and says how many it carried", () => {
		const carried = harvested(members(HARVEST_MEMBERS + 50)) as { quads: Array<{ at: number }>; totalItems: number; membersCarried: number };
		expect(
			carried.quads.map((q) => q.at),
			"the view states the order it wants them read",
		).toEqual(Array.from({ length: HARVEST_MEMBERS }, (_, at) => at));
		expect(carried.totalItems, "the count the view stated stands, so a reader is told how many the view holds").toBe(HARVEST_MEMBERS + 50);
		expect(carried.membersCarried).toBe(HARVEST_MEMBERS);
	});

	it("carries a view whose members a harvest holds as it stated it, saying nothing about carrying", () => {
		const whole = members(3);
		expect(harvested(whole)).toBe(whole);
	});

	it("carries the members whatever a view names them, and a summary with none as it is", () => {
		for (const key of ["items", "rows", "entries"]) {
			const carried = harvested(members(HARVEST_MEMBERS + 1, key)) as Record<string, unknown>;
			expect((carried[key] as unknown[]).length, key).toBe(HARVEST_MEMBERS);
		}
		const stated = { "@id": "view:one", name: "a view of one thing" };
		expect(harvested(stated)).toBe(stated);
	});

	it("is what the harvest sends, so no view sends more than a page carries", () => {
		document.body.innerHTML = "";
		const strip = document.createElement("shu-column-strip");
		strip.appendChild(pane("only", view("shu-polymorphic-graph-view", members(HARVEST_MEMBERS + 10))));
		document.body.appendChild(strip);
		activePane.set("only");
		const [block] = harvestChatViewLd() as Array<{ quads: unknown[] }>;
		expect(block.quads).toHaveLength(HARVEST_MEMBERS);
	});
});

describe("harvestChatViewLd: an active pane the signal cannot resolve", () => {
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
