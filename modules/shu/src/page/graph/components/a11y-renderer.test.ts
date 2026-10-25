// @vitest-environment jsdom
/**
 * The accessible document: the same draw feed every renderer gets, read as semantic HTML. These pin the reading
 * (type groups, or ONE time-ordered list in a lane view), the two-way wiring (activate opens, focus highlights),
 * the status line's delta announcements, and that focus survives a repaint.
 */
import { describe, it, expect, vi } from "vitest";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { A11yRenderer, type TA11yRendererDeps, type TReadingMarks } from "./a11y-renderer.js";
import { READ_STATE } from "../domains/views.js";
import type { FGLink, FGNode } from "../domains/graph-types.js";
import { SHU_TEST_IDS } from "../../../domains/test-ids.js";

const nodes: FGNode[] = [
	{ id: "c1", name: "a comment", type: "Comment", z: 36 },
	{ id: "p1", name: "the agent", type: "Principal", z: 0 },
	{ id: "c2", name: "a reply", type: "Comment", z: 72 },
];
const links: FGLink[] = [{ source: "c1", target: "p1", predicate: "attributedTo" }];

function harness(over: Partial<TA11yRendererDeps> = {}) {
	const region = document.createElement("nav");
	document.body.replaceChildren(region);
	const onActivate = vi.fn();
	const onFocus = vi.fn();
	const marks: TReadingMarks = { active: null, tierOf: () => "resting", pinned: () => false };
	const deps: TA11yRendererDeps = {
		region: () => region,
		bars: () => null,
		badgeOf: () => undefined,
		labelOf: (n) => n.name,
		marks: () => marks,
		groups: () => [],
		onActivate,
		onFocus,
		...over,
	};
	return { renderer: new A11yRenderer(deps), region, onActivate, onFocus };
}

describe("A11yRenderer: the graph as an accessible document", () => {
	it("reads as one script, in the order things were made, each line naming its actor, after the lifelines the view draws", () => {
		// A reading is a script, not a filing: the same events grouped into piles left a reader to reassemble them, and
		// what a reader wants is what happened, in order.
		const dated: FGNode[] = [
			{ id: "c2", name: "a reply", type: "Comment", __created: 300 },
			{ id: "p1", name: "the agent", type: "Principal", __created: 100 },
			{ id: "c1", name: "a comment", type: "Comment", __created: 200 },
		];
		const bars = [
			{ id: "p1", label: "the agent", nodeIds: ["c1", "c2"] },
			{ id: "p2", label: "the registry", nodeIds: [] },
		];
		const { renderer, region } = harness({ bars: () => bars });
		renderer.draw({ nodes: dated, links: [{ source: "c1", target: "p1", predicate: "attributedTo" }] });
		expect(
			[...region.querySelectorAll(`[data-testid="${SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y_LANES}"] li`)].map((li) => li.textContent),
			"each lifeline the picture draws, a lifeline that a line doesn't stand on too",
		).toEqual(["the agent", "the registry"]);
		const lists = region.querySelectorAll("ol");
		expect(lists.length, "one reading, not a pile per type").toBe(1);
		const speaker = (li: Element) => [...li.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent?.trim() ?? "")[0] ?? "";
		expect([...itemAt(lists, 0).children].map(speaker), "the actor of each line, where a line has one").toEqual(["", "the agent:", "the agent:"]);
		expect(
			[...itemAt(lists, 0).querySelectorAll(":scope > li > [data-node-id]")].map((b) => b.getAttribute("data-node-id")),
			"oldest first, whatever type each is",
		).toEqual(["p1", "c1", "c2"]);
		const edge = itemAt(lists, 0).querySelector("ul li");
		expect(edge?.textContent, "and what a line links to, under it").toBe("attributedTo → the agent");
		expect(edge?.querySelector("[data-node-id]")?.getAttribute("data-node-id"), "which is the way to that node: a reader follows the graph by its own relationships").toBe("p1");
	});

	it("reads a node its projection draws hollow as unbound, after the badge its projection puts on its cluster", () => {
		const { renderer, region } = harness({ badgeOf: (type) => (type === "r1" ? "∀" : undefined) });
		renderer.draw({
			nodes: [
				{ id: "r1:X1", name: "X1", type: "r1", hollow: true },
				{ id: "m1", name: "m1", type: "Email" },
			],
			links: [],
		});
		expect(
			[...region.querySelectorAll("[data-node-id]")].map((b) => b.textContent),
			"undated nodes read by name",
		).toEqual(["m1 (Email)", "X1 (∀ r1, unbound)"]);
	});

	it("summarises a fan instead of transcribing it, and reports a repeated edge once with its count", () => {
		// A cluster stands for the records it holds and points at every one of them. Listed, that is hundreds of lines
		// under one entry that a reader can't read.
		const members = Array.from({ length: 9 }, (_, at) => ({ id: `m${at}`, name: `member ${at}`, type: "SeqPath" }) as FGNode);
		const cluster: FGNode = { id: "cl", name: "+9 more", type: "SeqPath" };
		const { renderer, region } = harness();
		renderer.draw({
			nodes: [cluster, ...members],
			links: [...members.map((m) => ({ source: "cl", target: m.id, predicate: "clusterOf" })), { source: "cl", target: "m0", predicate: "clusterOf" }],
		});
		const under = [...(region.querySelector("li")?.querySelectorAll("ul li") ?? [])].map((li) => li.textContent);
		expect(under.length, "six lines and what is left, rather than every one of them").toBe(7);
		expect(under[0], "the same edge twice is listed once, with how many times").toBe("clusterOf → member 0 (×2)");
		expect(under.at(-1), "and a member isn't quietly dropped").toBe("… and 3 more");
	});

	it("goes on from where it stopped, so a member isn't out of a reader's reach", () => {
		// A reader who cannot see the picture has only this. Stating a first slice and stopping would put the rest
		// beyond them; stating all of it would build tens of thousands of lines on every repaint.
		const many: FGNode[] = Array.from({ length: 460 }, (_, at) => ({ id: `n${at}`, name: `record ${at}`, type: "SeqPath", __created: at }));
		const { renderer, region } = harness();
		renderer.draw({ nodes: many, links: [] });
		const readOn = () => region.querySelector<HTMLButtonElement>(`[data-testid="${SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y_READ_ON}"]`);
		expect(region.querySelectorAll("ol > li").length, "two hundred lines, and the way on").toBe(201);
		expect(readOn()?.textContent, "which states how much further it goes").toBe("read on: 260 more, in the same order");
		expect(region.querySelector("ol")?.getAttribute("aria-label"), "and the list states where it has got to").toContain("200 of 460 so far");
		expect(region.querySelector('[role="status"]')?.textContent, "while the status line states the whole").toContain("460 nodes");

		readOn()?.click();
		expect(region.querySelectorAll("ol > li").length, "the reading carries on from where it was").toBe(401);
		expect(readOn()?.textContent).toBe("read on: 60 more, in the same order");
		readOn()?.click();
		expect(region.querySelectorAll("ol > li").length, "to the end of it, where a control isn't left to press").toBe(460);
		expect(readOn(), "the way on is gone once every member is listed").toBeNull();
	});

	it("reports what can be opened: every node is an entry that acts, and the rest is text", () => {
		const { renderer, region } = harness();
		renderer.draw({ nodes, links });
		const acting = [...region.querySelectorAll("ol > li > button")];
		expect(
			acting.map((b) => b.textContent),
			"one for each drawn node, named with its type; undated records read by name",
		).toEqual(["a comment (Comment)", "a reply (Comment)", "the agent (Principal)"]);
		expect(
			acting.every((b) => b.hasAttribute("data-node-id")),
			"and each states which node it opens",
		).toBe(true);
		expect(region.querySelector("[data-testid='polymorphic-a11y-copy']"), "the region doesn't offer another control to press: the text is copied by selecting it").toBeNull();
	});

	it("activating an entry opens the node and focusing one highlights it: the pointer's own paths", () => {
		const { renderer, region, onActivate, onFocus } = harness();
		renderer.draw({ nodes, links });
		const button = region.querySelector<HTMLElement>('[data-node-id="c1"]');
		button?.click();
		expect(onActivate).toHaveBeenCalledWith("c1");
		button?.focus();
		expect(onFocus).toHaveBeenCalledWith("c1");
	});

	it("opens the node a press lands on without highlighting it first, so the entries don't reflow from under the press", () => {
		const { renderer, region, onActivate, onFocus } = harness();
		renderer.draw({ nodes, links });
		const entry = region.querySelector<HTMLElement>('ol > li > [data-node-id="c2"]');
		entry?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
		entry?.focus();
		entry?.click();
		expect(onFocus).not.toHaveBeenCalled();
		expect(onActivate).toHaveBeenCalledWith("c2");
		region.querySelector<HTMLElement>('ol > li > [data-node-id="c1"]')?.focus();
		expect(onFocus, "a keyboard reader's focus after the press highlights its node").toHaveBeenCalledWith("c1");
	});

	it("the status line announces the whole graph first, then only what changed", () => {
		const { renderer, region } = harness();
		renderer.draw({ nodes, links });
		const status = region.querySelector('[role="status"]');
		expect(status?.textContent).toBe("3 nodes (2 Comment, 1 Principal) and 1 links");
		renderer.draw({ nodes: [...nodes, { id: "p2", name: "a second agent", type: "Principal", z: 10 }], links });
		expect(status?.textContent).toBe("1 added, 0 removed, 4 nodes (2 Comment, 2 Principal) and 1 links");
	});

	it("a repaint keeps the reader's place: the focused entry is focused again on the new document", () => {
		const { renderer, region } = harness();
		renderer.draw({ nodes, links });
		region.querySelector<HTMLElement>('[data-node-id="c2"]')?.focus();
		renderer.draw({ nodes, links });
		expect(document.activeElement?.getAttribute("data-node-id")).toBe("c2");
	});

	it("keeps a node's entry on the document through a repaint, so a press a repaint lands within still opens the node", () => {
		const { renderer, region, onActivate } = harness();
		renderer.draw({ nodes, links });
		const entry = region.querySelector<HTMLElement>('ol > li > [data-node-id="c2"]');
		const watch = new MutationObserver(() => undefined);
		watch.observe(region, { childList: true, subtree: true });
		renderer.draw({ nodes: [...nodes, { id: "p2", name: "a second agent", type: "Principal", z: 10 }], links });
		const removed = watch.takeRecords().flatMap((record) => [...record.removedNodes]);
		expect(
			removed.filter((node) => node.contains(entry)),
			"the entry and the elements holding it stay on the document",
		).toEqual([]);
		entry?.click();
		expect(onActivate).toHaveBeenCalledWith("c2");
	});

	it("states the active node as the current entry, moves it to the next node made active, and doesn't state an entry current while the active node isn't drawn", () => {
		let active: string | null = "c1";
		const { renderer, region } = harness({ marks: () => ({ active, tierOf: () => "resting", pinned: () => false }) });
		renderer.draw({ nodes, links });
		const current = () => [...region.querySelectorAll('ol > li > [aria-current="true"]')].map((b) => b.getAttribute("data-node-id"));
		expect(current()).toEqual(["c1"]);
		active = "p1";
		renderer.mark();
		expect(current()).toEqual(["p1"]);
		active = null;
		renderer.mark();
		expect(current()).toEqual([]);
	});

	it("states a node a focus or a preview dims, and a node the reader dropped, and stops stating either once it doesn't hold", () => {
		let dimmed = new Set(["c2"]);
		let pinned = new Set(["p1"]);
		const { renderer, region } = harness({ marks: () => ({ active: null, tierOf: (n) => (dimmed.has(n.id) ? "dimmed" : "full"), pinned: (id) => pinned.has(id) }) });
		renderer.draw({ nodes, links });
		const entry = (id: string) => region.querySelector(`ol > li > [data-node-id="${id}"]`)?.textContent;
		expect(entry("c2")).toBe(`a reply (Comment, ${READ_STATE.dimmed})`);
		expect(entry("p1")).toBe(`the agent (Principal, ${READ_STATE.pinned})`);
		expect(entry("c1")).toBe("a comment (Comment)");
		[dimmed, pinned] = [new Set(), new Set()];
		renderer.mark();
		expect([entry("c2"), entry("p1")]).toEqual(["a reply (Comment)", "the agent (Principal)"]);
	});

	it("names each node by what its chip reads, which is the value that places its depth where chips read that", () => {
		const { renderer, region } = harness({ labelOf: (n) => `${n.z}` });
		renderer.draw({ nodes, links });
		expect([...region.querySelectorAll("ol > li > [data-node-id]")].map((b) => b.textContent)).toEqual(["36 (Comment)", "72 (Comment)", "0 (Principal)"]);
		expect(region.querySelector("ol ul li")?.textContent, "and the way to a node names it the same").toBe("attributedTo → 0");
	});

	it("states the title of each box the picture draws around a group, and doesn't state a title while the view doesn't group", () => {
		let groups = ["Comment", "Principal"];
		const { renderer, region } = harness({ groups: () => groups });
		renderer.draw({ nodes, links });
		const titles = () => [...region.querySelectorAll(`[data-testid="${SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y_GROUPS}"] li`)].map((li) => li.textContent);
		expect(titles()).toEqual(groups);
		groups = [];
		renderer.draw({ nodes, links });
		expect(titles()).toEqual([]);
	});

	it("states the graph busy while what it shows still changes, and at rest otherwise", () => {
		const { renderer, region } = harness();
		renderer.busy(true);
		expect(region.getAttribute("aria-busy")).toBe("true");
		renderer.busy(false);
		expect(region.getAttribute("aria-busy")).toBe("false");
	});

	it("keeps the reader's focus on their entry while it states what changed in the picture", () => {
		const { renderer, region } = harness();
		renderer.draw({ nodes, links });
		region.querySelector<HTMLElement>('[data-node-id="c2"]')?.focus();
		renderer.mark();
		expect(document.activeElement?.getAttribute("data-node-id")).toBe("c2");
	});

	it("a link naming an undrawn node is a defect, exactly as in every other medium", () => {
		const { renderer } = harness();
		expect(() => renderer.draw({ nodes, links: [{ source: "c1", target: "missing", predicate: "inReplyTo" }] })).toThrow(/not drawn/);
	});
});
