// @vitest-environment jsdom
/**
 * Spec: the members a page sends of a view that states many members. `ViewCollectionSchema` defines the block's shape.
 *
 * The page's bound on members limits the payload size. It doesn't limit what a model's window holds. The turn selects
 * what its window holds of the members that arrive. It states the members the window held out and the call that reads them.
 * A bounded block states the page terms. `partOf` names the view's address, since the page doesn't have an address of its
 * own. `totalItems` states the count the collection holds beside the members `items` carries. A block doesn't state a
 * `@type`, because a context payload isn't a resource persisted and served on an endpoint. The boundary that persists or
 * serves a resource states its type. A block that states `items` must conform to `ViewCollectionSchema`. The harvest
 * rejects a non-conformant summary with an error that names the view, and doesn't truncate the summary. The harvest
 * carries a view that doesn't state a collection unchanged. A graph view that states its nodes and edges under their own
 * names is such a view.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import { HARVEST_MEMBERS, harvested, harvestChatViewLd } from "./chat-context-harvest.js";
import { activePane } from "./page/root.js";

type TView = HTMLElement & { summarizeForKihan(): unknown | null };

/** A duck-typed view. The harvester checks for the method and not the class, since each bundle defines its own classes. */
const view = (tag: string, summary: unknown | null): TView => {
	const el = document.createElement(tag) as TView;
	el.summarizeForKihan = () => summary;
	return el;
};

const collection = (count: number) => ({ "@id": "view:graph", totalItems: count, items: Array.from({ length: count }, (_, at) => ({ at })) });

describe("what a page sends of a view that states many members", () => {
	it("carries the view's first members in the view's order, and states the page terms", () => {
		const carried = harvested(collection(HARVEST_MEMBERS + 50)) as Record<string, unknown>;
		expect(carried.partOf, "the page doesn't have an address of its own: it pages the collection at the view's address").toBe("view:graph");
		expect(
			(carried.items as Array<{ at: number }>).map((m) => m.at),
			"the page keeps the members in the order the view states",
		).toEqual(Array.from({ length: HARVEST_MEMBERS }, (_, at) => at));
		expect(carried.totalItems, "the page keeps the count the view stated, so a reader reads how many members the view holds").toBe(HARVEST_MEMBERS + 50);
		expect("membersCarried" in carried, "items holds the members that arrived, and totalItems beside it states the whole count").toBe(false);
		expect(carried["@type"], "a context payload doesn't state a resource type; the boundary that persists or serves a resource states it").toBeUndefined();
	});

	it("states the number of members the view holds as the count when the view doesn't state a count", () => {
		const unstated = { "@id": "view:many", items: Array.from({ length: HARVEST_MEMBERS + 1 }, (_, at) => ({ at })) };
		expect(harvested(unstated).totalItems).toBe(HARVEST_MEMBERS + 1);
	});

	it("carries a view unchanged when a page holds all of its members", () => {
		const whole = collection(3);
		expect(harvested(whole)).toBe(whole);
	});

	it("sends a view unchanged when it states two member sets under their own names", () => {
		// A 2D graph states its nodes and edges under their own names. Two member sets don't form a collection, so a page
		// sends the view in the shape the view states.
		const graph = {
			"@id": "view:graph-2d",
			name: "a graph of 300 nodes and 400 edges",
			nodeCount: 300,
			edgeCount: 400,
			nodes: Array.from({ length: 300 }, () => ({})),
			edges: Array.from({ length: 400 }, () => ({})),
		};
		expect(harvested(graph)).toBe(graph);
	});

	it("carries a summary without members unchanged", () => {
		const stated = { "@id": "view:one", name: "a view of one thing" };
		expect(harvested(stated)).toBe(stated);
	});

	it("rejects a block whose items don't conform to the schema", () => {
		const bad = { "@id": "view:bad", totalItems: "many", items: [{ at: 0 }] };
		expect(() => harvested(bad)).toThrow();
	});
});

describe("the harvest rejects a non-conformant summary with an error that names the view", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		activePane.set(null);
	});

	/** A pane whose `label` is also its columnKey. The `activePane` signal holds a pane's columnKey, so a test marks the
	 *  pane active by `activePane.set(label)`. The harvester reads the active pane from that signal alone, as with the real strip. */
	const pane = (label: string, ...children: Element[]): HTMLElement => {
		const p = document.createElement("shu-column-pane");
		p.setAttribute("label", label);
		p.dataset.columnKey = label;
		for (const c of children) p.appendChild(c);
		return p;
	};

	it("names the view whose summary the schema rejects, and doesn't truncate the summary", () => {
		const strip = document.createElement("shu-column-strip");
		strip.appendChild(pane("bad", view("shu-bad-view", { "@id": "view:bad", totalItems: "many", items: [{ at: 0 }] })));
		document.body.appendChild(strip);
		activePane.set("bad");
		expect(() => harvestChatViewLd()).toThrow(/shu-bad-view/);
	});

	it("bounds the members a view sends in the harvest to the members a page carries", () => {
		const strip = document.createElement("shu-column-strip");
		strip.appendChild(pane("only", view("shu-polymorphic-graph-view", collection(HARVEST_MEMBERS + 10))));
		document.body.appendChild(strip);
		activePane.set("only");
		const block = itemAt(harvestChatViewLd() as Array<{ items: unknown[] }>, 0);
		expect(block.items).toHaveLength(HARVEST_MEMBERS);
	});
});
