// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { harvestChatViewLd } from "./chat-context-harvest.js";

type TView = HTMLElement & { summarizeForKihan(): unknown | null };

/** A duck-typed view: the harvester recognises the method, never the class (cross-bundle identity). */
function view(tag: string, summary: unknown | null): TView {
	const el = document.createElement(tag) as TView;
	el.summarizeForKihan = () => summary;
	return el;
}

function pane(label: string | null, ...children: Element[]): HTMLElement {
	const p = document.createElement("shu-column-pane");
	if (label) p.setAttribute("label", label);
	for (const c of children) p.appendChild(c);
	return p;
}

describe("harvestChatViewLd — the active pane's linked data plus the pane manifest", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	function mount(...panes: HTMLElement[]): void {
		const strip = document.createElement("shu-column-strip");
		for (const p of panes) strip.appendChild(p);
		document.body.appendChild(strip);
	}

	it("harvests the pane marked [active] — never a positional index — and appends the manifest of every pane", () => {
		const a = pane("first", view("shu-entity-column", { "@id": "e1" }));
		const b = pane("second", view("shu-document-column", { "@id": "d1" }));
		b.setAttribute("active", "");
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
		p.setAttribute("active", "");
		mount(p);
		const blocks = harvestChatViewLd();
		// The host's summary only — the nested scene is the host's own concern.
		expect(blocks.filter((b) => (b as { "@id"?: string })["@id"] === "graph")).toHaveLength(1);
		expect(blocks.filter((b) => (b as { "@id"?: string })["@id"] === "scene")).toHaveLength(0);
	});

	it("a null summary contributes nothing; the manifest still lists the pane", () => {
		const p = pane("controls", view("shu-views-picker", null));
		p.setAttribute("active", "");
		mount(p);
		const blocks = harvestChatViewLd();
		expect(blocks).toHaveLength(1); // manifest only
		expect((blocks[0] as { items: unknown[] }).items).toHaveLength(1);
	});

	it("returns empty with no strip mounted", () => {
		expect(harvestChatViewLd()).toEqual([]);
	});
});
