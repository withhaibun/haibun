// @vitest-environment jsdom
/**
 * What a focus does to the drawn graph: the active node alone wears the glow, a focus lights its neighbourhood and dims the
 * rest, nodes and edges alike, a preview of a type wins over the focus, the focused chip pops up to a readable size and
 * returns to its natural size, and a focus doesn't move a node. Driven through applyFocus, the pass a selection, a hover and a
 * preview each run.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PolymorphicFocus, type FocusDeps } from "./focus-controller.js";
import type { TGraphPreview } from "../derivations/focus-policy.js";
import type { FGLink, FGNode, NodeVisual } from "../domains/graph-types.js";

const TIERS = { full: 1, dimmed: 0.15, resting: 0.6 };
/** A hover pop past this reads as huge rather than readable. */
const HOVER_POP_MAX = 2.6;

const visual = (): NodeVisual => {
	const v = {
		object: { renderOrder: 0, scale: { set: () => undefined } } as never,
		pickTarget: {} as never,
		hasHighlight: false,
		layingOut: false,
		opacity: 1,
		setHighlighted(on: boolean) {
			v.hasHighlight = on;
		},
		faceCamera: () => undefined,
	};
	return v;
};

/** The canvas a line colour is normalised through, which jsdom doesn't paint: the colour falls back to its resting grey. */
beforeAll(() => vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null));

/** Messages linked as a mailbox links them: b replies to a, c references a, d references e. */
function mailbox(over: { worldPerPx?: number } = {}) {
	const node = (id: string, type: string, x: number): FGNode => ({ id, name: id, type, x, y: x / 2, z: 0, __k: 1, __baseScale: { x: 1, y: 1 }, __visual: visual() });
	const nodes = [node("a", "Email", 0), node("b", "Email", 40), node("c", "Email", -40), node("d", "Email", 80), node("e", "Email", -80), node("p", "Person", 120)];
	const links: FGLink[] = [
		{ source: "b", target: "a", predicate: "inReplyTo" },
		{ source: "c", target: "a", predicate: "references" },
		{ source: "d", target: "e", predicate: "references" },
	];
	const state = { selected: null as string | null, hovered: null as string | null, preview: null as TGraphPreview | null };
	const deps = {
		focusId: () => state.selected ?? state.hovered,
		selectedId: () => state.selected,
		preview: () => state.preview,
		groupOf: (n: FGNode) => n.type,
		nodeMap: () => new Map(nodes.map((n) => [n.id, n])),
		decorates: () => false,
		currentLinks: () => links,
		enclosures: () => new Map(),
		graph: () => undefined,
		engineFrozen: () => false,
		pinNode: () => undefined,
		worldPerPxAt: () => over.worldPerPx ?? 1,
		focusEdgeColor: () => "#222222",
		edgeLineColor: () => "#888888",
		edgeLabelColor: () => "#555555",
		focusTextPx: () => 13,
		glowRamp: () => ["#ffcc88"],
		nodeTiers: TIERS,
		lineTiers: TIERS,
		edgeLabelTiers: TIERS,
		enclosureFillTiers: TIERS,
		enclosureEdgeTiers: TIERS,
		enclosureLabelTiers: TIERS,
	} as unknown as FocusDeps;
	const focus = new PolymorphicFocus(deps);
	const byId = (id: string): FGNode => {
		const n = nodes.find((m) => m.id === id);
		if (n === undefined) throw new Error(`the mailbox doesn't hold ${id}`);
		return n;
	};
	const opacity = (id: string): number => byId(id).__visual?.opacity ?? Number.NaN;
	const lineAlpha = (l: FGLink): number => Number(focus.lineRgbaFor(l).match(/,([\d.]+)\)$/)?.[1]);
	const highlighted = (): string[] => nodes.filter((n) => n.__visual?.hasHighlight).map((n) => n.id);
	return { focus, nodes, links, state, byId, opacity, lineAlpha, highlighted };
}

describe("the active node's glow", () => {
	it("is worn by the active node alone, and moves to the next node opened", () => {
		const { focus, state, highlighted } = mailbox();
		state.selected = "c";
		focus.applyFocus();
		expect(highlighted()).toEqual(["c"]);
		state.selected = "b";
		focus.applyFocus();
		expect(highlighted()).toEqual(["b"]);
	});

	it("isn't worn while the graph doesn't draw the selected node, and returns to it when the graph draws it again", () => {
		const { focus, state, nodes, highlighted } = mailbox();
		state.selected = "p";
		focus.applyFocus();
		const person = nodes.splice(
			nodes.findIndex((n) => n.id === "p"),
			1,
		);
		focus.applyFocus();
		expect(highlighted(), "a filtered-out selection leaves the graph without a glow").toEqual([]);
		nodes.push(...person);
		focus.applyFocus();
		expect(highlighted()).toEqual(["p"]);
	});
});

describe("a focus", () => {
	it("lights the focused node's neighbourhood and dims the rest, nodes and the edges between them", () => {
		const { focus, state, opacity, lineAlpha, links } = mailbox();
		state.selected = "a";
		focus.applyFocus();
		expect(["a", "b", "c"].map(opacity), "the node and its neighbours").toEqual([TIERS.full, TIERS.full, TIERS.full]);
		expect(["d", "e", "p"].map(opacity), "every other node").toEqual([TIERS.dimmed, TIERS.dimmed, TIERS.dimmed]);
		expect(links.map(lineAlpha), "its own edges full, the edge it doesn't touch dim").toEqual([TIERS.full, TIERS.full, TIERS.dimmed]);
	});

	it("keeps the edge split after the hover leaves, while the selection holds the focus", () => {
		const { focus, state, links, lineAlpha } = mailbox();
		state.selected = "a";
		state.hovered = "a";
		focus.applyFocus();
		state.hovered = null;
		focus.applyFocus();
		expect(links.map(lineAlpha)).toEqual([TIERS.full, TIERS.full, TIERS.dimmed]);
	});

	it("states each node's tier as the picture draws it, which the reading of the graph states", () => {
		const { focus, state, nodes } = mailbox();
		state.selected = "a";
		focus.applyFocus();
		const tierOf = focus.tierOf();
		expect(nodes.map((n) => [n.id, tierOf(n)])).toEqual(nodes.map((n) => [n.id, n.__visual?.opacity === TIERS.dimmed ? "dimmed" : "full"]));
	});

	it("gives way to a preview of a type: that type lights and every other type dims, focus or not", () => {
		const { focus, state, opacity } = mailbox();
		state.selected = "c";
		state.preview = { type: "Email" };
		focus.applyFocus();
		expect(["a", "b", "c", "d", "e"].map(opacity)).toEqual(Array(5).fill(TIERS.full));
		expect(opacity("p")).toBe(TIERS.dimmed);
	});

	it("doesn't move a node, whichever node it lands on in turn", () => {
		const { focus, state, nodes } = mailbox();
		const placed = (): string => nodes.map((n) => `${n.x},${n.y},${n.z}`).join("|");
		const before = placed();
		for (const id of ["a", "b", "a"]) {
			state.selected = id;
			focus.applyFocus();
		}
		state.hovered = "d";
		focus.applyFocus();
		expect(placed()).toBe(before);
	});
});

describe("the hovered chip's pop", () => {
	it("pops a chip too small to read up to a readable size, and returns it to its natural size when the pointer leaves the chip", () => {
		const { focus, state, byId } = mailbox({ worldPerPx: 40 });
		state.hovered = "a";
		focus.applyFocus();
		const popped = byId("a").__k ?? Number.NaN;
		expect(popped, "the chip pops").toBeGreaterThan(1);
		expect(popped, "but not to a huge size").toBeLessThanOrEqual(HOVER_POP_MAX);
		state.hovered = null;
		focus.applyFocus();
		expect(byId("a").__k).toBe(1);
	});
});
