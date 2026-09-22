// @vitest-environment jsdom
/**
 * Spec: what a page sends of a view that states many members — the schema is the feature.
 *
 * The page's bound on members is a safeguard on the payload, not the limit of what fits: what a model's window holds
 * of what arrives is the turn's to decide against its own window, and it states the members the window held out and
 * the call that reads them. Capped, a block states the page terms: `partOf` (the page has no address of its own), the
 * count the collection holds stands against what `items` carries — and no `@type` claim, because a context payload
 * is not a resource persisted and offered on an endpoint; the claim belongs to the boundary. A block that states
 * `items` is held to `ViewCollectionSchema`: a non-conformant summary is rejected loudly, naming the view, never
 * silently trimmed. A view that states no collection — a graph stating its nodes and edges under their own names —
 * is carried as it stated.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { HARVEST_MEMBERS, harvested, harvestChatViewLd } from "./chat-context-harvest.js";
import { activePane } from "./signals.js";

type TView = HTMLElement & { summarizeForKihan(): unknown | null };

/** A duck-typed view: the harvester recognises the method, never the class (cross-bundle identity). */
const view = (tag: string, summary: unknown | null): TView => {
	const el = document.createElement(tag) as TView;
	el.summarizeForKihan = () => summary;
	return el;
};

const collection = (count: number) => ({
	"@id": "view:graph",
	totalItems: count,
	items: Array.from({ length: count }, (_, at) => ({ at })),
});

describe("what a page sends of a view that states many members", () => {
	it("carries the members the view stated first, and states the page terms", () => {
		const carried = harvested(collection(HARVEST_MEMBERS + 50)) as Record<string, unknown>;
		expect(carried.partOf, "the page has no address of its own: it pages the collection at the view's address").toBe("view:graph");
		expect((carried.items as Array<{ at: number }>).map((m) => m.at), "the view states the order it wants them read").toEqual(Array.from({ length: HARVEST_MEMBERS }, (_, at) => at));
		expect(carried.totalItems, "the count the view stated stands, so a reader is told how many the view holds").toBe(HARVEST_MEMBERS + 50);
		expect("membersCarried" in carried, "what arrived is what items carries; the count standing against it says so").toBe(false);
		expect(carried["@type"], "a context payload claims no resource type; the claim belongs to the boundary").toBeUndefined();
	});

	it("states the members held as the count when a view states no count", () => {
		const unstated = { "@id": "view:many", items: Array.from({ length: HARVEST_MEMBERS + 1 }, (_, at) => ({ at })) };
		expect(harvested(unstated).totalItems).toBe(HARVEST_MEMBERS + 1);
	});

	it("carries a view whose members a page holds as it stated it, saying nothing about carrying", () => {
		const whole = collection(3);
		expect(harvested(whole)).toBe(whole);
	});

	it("sends a view stating two member sets under their own names as it stated it, saying nothing about carrying", () => {
		// A 2D graph states its nodes and edges under their own names: two member sets, which a collection is not, so
		// the view states its own shape and a page sends it as it stated it.
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

	it("carries a summary with no members as it is", () => {
		const stated = { "@id": "view:one", name: "a view of one thing" };
		expect(harvested(stated)).toBe(stated);
	});

	it("rejects a block that states items non-conformantly: the schema is the shape, and it is enforced", () => {
		const bad = { "@id": "view:bad", totalItems: "many", items: [{ at: 0 }] };
		expect(() => harvested(bad)).toThrow();
	});
});

describe("the harvest rejects a non-conformant summary loudly, naming the view", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		activePane.set(null);
	});

	/** A pane whose `label` doubles as its columnKey (its identity in the `activePane` signal), so a test marks it
	 *  active by `activePane.set(label)`: the one source of truth the harvester reads, mirroring the real strip. */
	const pane = (label: string, ...children: Element[]): HTMLElement => {
		const p = document.createElement("shu-column-pane");
		p.setAttribute("label", label);
		p.dataset.columnKey = label;
		for (const c of children) p.appendChild(c);
		return p;
	};

	it("names the view whose summary the schema refuses, rather than trimming it silently", () => {
		const strip = document.createElement("shu-column-strip");
		strip.appendChild(pane("bad", view("shu-bad-view", { "@id": "view:bad", totalItems: "many", items: [{ at: 0 }] })));
		document.body.appendChild(strip);
		activePane.set("bad");
		expect(() => harvestChatViewLd()).toThrow(/shu-bad-view/);
	});

	it("is what the harvest sends, so no view sends more members than a page carries", () => {
		const strip = document.createElement("shu-column-strip");
		strip.appendChild(pane("only", view("shu-polymorphic-graph-view", collection(HARVEST_MEMBERS + 10))));
		document.body.appendChild(strip);
		activePane.set("only");
		const [block] = harvestChatViewLd() as Array<{ items: unknown[] }>;
		expect(block.items).toHaveLength(HARVEST_MEMBERS);
	});
});
