import { describe, expect, it } from "vitest";
import { approximateChipWidth, EGO_CHIP_PADDING, EGO_VIEWPORT_MARGIN, MAX_EGO_NEIGHBOURS, extractEgoGraph, placeOffscreen, type TEgoGraph, type TEgoView } from "./ego-layout.js";
import type { FGLink, FGNode, XYZ } from "../domains/graph-types.js";

const centerNode: FGNode & XYZ = { id: "c0", name: "Center", type: "Email", x: 100, y: 50, z: 200 };
const at = (id: string, x: number, y: number, z = 200): FGNode & XYZ => ({ id, name: `Neighbour ${id}`, type: "Item", x, y, z });
const egoOf = (...nodes: Array<FGNode & XYZ>): TEgoGraph => ({
	center: centerNode,
	neighbours: nodes.map((node) => ({ node, link: { source: "c0", target: node.id, predicate: "rel" }, direction: "out" as const })),
	totalNeighbours: nodes.length,
});
/** A camera that looks down z: 200 world units from the centre reach the viewport's edge. */
const VIEW: TEgoView = {
	basis: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
	project: (p) => ({ x: (p.x - 100) / 200, y: (p.y - 50) / 200, inFront: true }),
	bounds: { rx: 200 * EGO_VIEWPORT_MARGIN, ry: 200 * EGO_VIEWPORT_MARGIN },
};

describe("extractEgoGraph", () => {
	const n1 = at("n1", 200, 150);
	const n2 = at("n2", -50, -20);
	const nodeMap = new Map<string, FGNode>([centerNode, n1, n2].map((n) => [n.id, n]));

	it("reads each neighbour once, by the direction of its first link", () => {
		const links: FGLink[] = [
			{ source: "c0", target: "n1", predicate: "sender" },
			{ source: "n2", target: "c0", predicate: "about" },
			{ source: "n1", target: "c0", predicate: "replyTo" },
		];
		const ego = extractEgoGraph("c0", nodeMap, links);
		expect(ego?.neighbours.map(({ node, direction }) => [node.id, direction])).toEqual([
			["n1", "out"],
			["n2", "in"],
		]);
		expect(ego?.totalNeighbours).toBe(2);
	});

	it("reads the first MAX_EGO_NEIGHBOURS and counts every neighbour", () => {
		const many = Array.from({ length: MAX_EGO_NEIGHBOURS + 2 }, (_, i) => at(`m${i}`, i, i));
		const map = new Map<string, FGNode>([centerNode, ...many].map((n) => [n.id, n]));
		const ego = extractEgoGraph(
			"c0",
			map,
			many.map((n) => ({ source: "c0", target: n.id, predicate: "rel" })),
		);
		expect(ego?.neighbours).toHaveLength(MAX_EGO_NEIGHBOURS);
		expect(ego?.totalNeighbours).toBe(MAX_EGO_NEIGHBOURS + 2);
	});
});

describe("placeOffscreen", () => {
	it("doesn't place a neighbour inside the viewport", () => {
		expect(placeOffscreen(egoOf(at("vis1", 110, 60), at("vis2", 90, 40)), VIEW)).toEqual([]);
	});

	it("places an off-screen neighbour within the margin, on its edge's curve, with a spoke from the centre", () => {
		const [far] = placeOffscreen(egoOf(at("far1", 900, 650)), VIEW);
		if (far === undefined) throw new Error("the neighbour isn't placed");
		const ndc = VIEW.project(far.pos);
		expect(Math.max(Math.abs(ndc.x), Math.abs(ndc.y))).toBeLessThanOrEqual(EGO_VIEWPORT_MARGIN);
		expect(far.spokePoints[0]).toEqual({ x: 100, y: 50, z: 200 });
		expect(far.spokePoints.at(-1)).toEqual(far.pos);
	});

	it("places a neighbour straight behind the centre at a finite point on the margin", () => {
		const [behind] = placeOffscreen(egoOf(at("behind", 100, 50, -900)), { ...VIEW, project: (p) => ({ ...VIEW.project(p), inFront: p.z > 0 }) });
		expect([behind?.pos.x, behind?.pos.y, behind?.pos.z].every(Number.isFinite)).toBe(true);
	});

	it("moves two off-screen chips that land at one place apart until their boxes don't overlap", () => {
		const placed = placeOffscreen(egoOf(at("col1", 1000, 500), at("col2", 1002, 501)), VIEW);
		const [a, b] = placed.map(({ pos }) => pos);
		if (a === undefined || b === undefined) throw new Error("the chips aren't placed");
		const width = approximateChipWidth("Neighbour col1") + EGO_CHIP_PADDING;
		expect(Math.abs(b.x - a.x) >= width || Math.abs(b.y - a.y) >= 4.2).toBe(true);
	});
});
