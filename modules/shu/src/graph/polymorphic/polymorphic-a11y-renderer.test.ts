// @vitest-environment jsdom
/**
 * The accessible document: the same draw feed every renderer gets, read as semantic HTML. These pin the reading
 * (type groups, or ONE time-ordered list in a lane view), the two-way wiring (activate opens, focus highlights),
 * the status line's delta announcements, and that focus survives a repaint.
 */
import { describe, it, expect, vi } from "vitest";
import { A11yRenderer, type TA11yRendererDeps } from "./polymorphic-a11y-renderer.js";
import type { FGLink, FGNode } from "../polymorphic/polymorphic-graph-types.js";
import { SHU_TEST_IDS } from "../../test-ids.js";

const nodes: FGNode[] = [
	{ id: "c1", name: "a comment", type: "Comment", z: 36 },
	{ id: "p1", name: "the agent", type: "Principal", z: 0 },
	{ id: "c2", name: "a reply", type: "Comment", z: 72 },
];
const links: FGLink[] = [{ source: "c1", target: "p1", predicate: "attributedTo" }];

function harness(over: Partial<TA11yRendererDeps> = {}) {
	const region = document.createElement("nav");
	document.body.append(region);
	const onActivate = vi.fn();
	const onFocus = vi.fn();
	const deps: TA11yRendererDeps = { region: () => region, bars: () => null, onActivate, onFocus, ...over };
	return { renderer: new A11yRenderer(deps), region, onActivate, onFocus };
}

describe("A11yRenderer: the graph as an accessible document", () => {
	it("reads as one script, in the order things were made, each line saying who it belongs to", () => {
		// A reading is a script, not a filing: the same events grouped into piles left a reader to reassemble them, and
		// what a reader wants is what happened, in order.
		const dated: FGNode[] = [
			{ id: "c2", name: "a reply", type: "Comment", __created: 300 },
			{ id: "p1", name: "the agent", type: "Principal", __created: 100 },
			{ id: "c1", name: "a comment", type: "Comment", __created: 200 },
		];
		const { renderer, region } = harness({ bars: () => [{ id: "p1", label: "the agent", nodeIds: ["c1", "c2"] }] });
		renderer.draw({ nodes: dated, links: [{ source: "c1", target: "p1", predicate: "attributedTo" }] });
		const lists = region.querySelectorAll("ol");
		expect(lists.length, "one reading, not a pile per type").toBe(1);
		const speaker = (li: Element) => [...li.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent?.trim() ?? "")[0] ?? "";
		expect([...lists[0].children].map(speaker), "who each line belongs to, where it belongs to anyone").toEqual(["", "the agent:", "the agent:"]);
		expect(
			[...lists[0].querySelectorAll(":scope > li > [data-node-id]")].map((b) => b.getAttribute("data-node-id")),
			"oldest first, whatever type each is",
		).toEqual(["p1", "c1", "c2"]);
		const edge = lists[0].querySelector("ul li");
		expect(edge?.textContent, "and what a line links to, under it").toBe("attributedTo → the agent");
		expect(edge?.querySelector("[data-node-id]")?.getAttribute("data-node-id"), "which is the way to that node: a reader follows the graph by its own relationships").toBe("p1");
	});

	it("summarises a fan instead of transcribing it, and says a repeated edge once with its count", () => {
		// A cluster stands for the records it holds and points at every one of them. Listed, that is hundreds of lines
		// under one entry and no reading at all.
		const members = Array.from({ length: 9 }, (_, at) => ({ id: `m${at}`, name: `member ${at}`, type: "SeqPath" }) as FGNode);
		const cluster: FGNode = { id: "cl", name: "+9 more", type: "SeqPath" };
		const { renderer, region } = harness();
		renderer.draw({
			nodes: [cluster, ...members],
			links: [...members.map((m) => ({ source: "cl", target: m.id, predicate: "clusterOf" })), { source: "cl", target: "m0", predicate: "clusterOf" }],
		});
		const under = [...(region.querySelector("li")?.querySelectorAll("ul li") ?? [])].map((li) => li.textContent);
		expect(under.length, "six lines and what is left, rather than every one of them").toBe(7);
		expect(under[0], "the same edge twice is said once, with how many times").toBe("clusterOf → member 0 (×2)");
		expect(under.at(-1), "and nothing is quietly dropped").toBe("… and 3 more");
	});

	it("goes on from where it stopped, so nothing is out of a reader's reach", () => {
		// A reader who cannot see the picture has only this. Stating a first slice and stopping would put the rest
		// beyond them; stating all of it would build tens of thousands of lines on every repaint.
		const many: FGNode[] = Array.from({ length: 460 }, (_, at) => ({ id: `n${at}`, name: `record ${at}`, type: "SeqPath", __created: at }));
		const { renderer, region } = harness();
		renderer.draw({ nodes: many, links: [] });
		const readOn = () => region.querySelector<HTMLButtonElement>(`[data-testid="${SHU_TEST_IDS.POLYMORPHIC_VIEW.A11Y_READ_ON}"]`);
		expect(region.querySelectorAll("ol > li").length, "two hundred lines, and the way on").toBe(201);
		expect(readOn()?.textContent, "which says how much further it goes").toBe("read on: 260 more, in the same order");
		expect(region.querySelector("ol")?.getAttribute("aria-label"), "and the list says where it has got to").toContain("200 of 460 so far");
		expect(region.querySelector('[role="status"]')?.textContent, "while the status line states the whole").toContain("460 nodes");

		readOn()?.click();
		expect(region.querySelectorAll("ol > li").length, "the reading carries on from where it was").toBe(401);
		expect(readOn()?.textContent).toBe("read on: 60 more, in the same order");
		readOn()?.click();
		expect(region.querySelectorAll("ol > li").length, "to the end of it, where there is nothing left to press").toBe(460);
		expect(readOn(), "the way on is gone once there is no more").toBeNull();
	});

	it("says what can be opened: every node is an entry that acts, and the rest is text", () => {
		const { renderer, region } = harness();
		renderer.draw({ nodes, links });
		const acting = [...region.querySelectorAll("ol > li > button")];
		expect(
			acting.map((b) => b.textContent),
			"one for each drawn node, named with its type; undated records read by name",
		).toEqual(["a comment (Comment)", "a reply (Comment)", "the agent (Principal)"]);
		expect(
			acting.every((b) => b.hasAttribute("data-node-id")),
			"and each says which node it opens",
		).toBe(true);
		expect(region.querySelector("[data-testid='polymorphic-a11y-copy']"), "nothing else to press: the text is copied by selecting it").toBeNull();
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

	it("a link naming an undrawn node is a defect, exactly as in every other medium", () => {
		const { renderer } = harness();
		expect(() => renderer.draw({ nodes, links: [{ source: "c1", target: "missing", predicate: "inReplyTo" }] })).toThrow(/not drawn/);
	});
});
