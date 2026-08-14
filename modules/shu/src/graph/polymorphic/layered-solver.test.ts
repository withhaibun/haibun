import { describe, it, expect } from "vitest";
import { nodeWidth } from "../layered-layout.js";
import { layeredPositions } from "./layered-solver.js";
import { truncateLabel, MAX_LABEL_CHARS } from "./layout-forces.js";

const N = (id: string) => ({ id, label: id.toUpperCase() });

/** Every input node gets a box, so a miss is a solver bug — fail fast rather than reach through an optional. */
const at = (p: Map<string, { x: number; y: number }>, id: string): { x: number; y: number } => {
	const v = p.get(id);
	if (!v) throw new Error(`no layered position for ${id}`);
	return v;
};

describe("layered solver: td/lr structural pin positions", () => {
	it("TB: a child's layer advances down y, so the flow reads top-to-bottom", () => {
		const edges = [
			{ from: "a", to: "b" },
			{ from: "b", to: "c" },
		];
		const p = layeredPositions([N("a"), N("b"), N("c")], edges, "TB");
		expect(at(p, "a").y).toBeLessThan(at(p, "b").y);
		expect(at(p, "b").y).toBeLessThan(at(p, "c").y);
	});

	it("LR: a child's layer advances along x, so the flow reads left-to-right", () => {
		const p = layeredPositions([N("a"), N("b")], [{ from: "a", to: "b" }], "LR");
		expect(at(p, "a").x).toBeLessThan(at(p, "b").x);
	});

	it("siblings in one layer are spread on the cross axis, never stacked on a single point", () => {
		const edges = [
			{ from: "root", to: "x" },
			{ from: "root", to: "y" },
		];
		const p = layeredPositions([N("root"), N("x"), N("y")], edges, "TB");
		expect(at(p, "x").x).not.toBe(at(p, "y").x); // the cross axis (x for TB) separates them
		expect(at(p, "x").y).toBeCloseTo(at(p, "y").y); // but they share the layer (same y)
	});

	it("an edge to a missing node and a self-edge are ignored, not crashed on", () => {
		const edges = [
			{ from: "a", to: "ghost" },
			{ from: "b", to: "b" },
			{ from: "a", to: "b" },
		];
		const p = layeredPositions([N("a"), N("b")], edges, "TB");
		expect(p.size).toBe(2);
		expect(at(p, "a").y).toBeLessThan(at(p, "b").y);
	});
});

describe("layered solver: compact + bounded ranks (no unbounded fan-out)", () => {
	const chain = ["a", "b", "c", "d"];
	const chainEdges = [
		{ from: "a", to: "b" },
		{ from: "b", to: "c" },
		{ from: "c", to: "d" },
	];

	it("ranks are DISJOINT bands — consecutive layers sit more than a node-height (30) apart", () => {
		const p = layeredPositions(chain.map(N), chainEdges, "TB");
		expect(at(p, "b").y - at(p, "a").y).toBeGreaterThan(30);
		expect(at(p, "c").y - at(p, "b").y).toBeGreaterThan(30);
	});

	it("a chain is COMPACT — its rank axis (y) spans more than its cross axis (x); a single node doesn't fan its layer out", () => {
		const p = layeredPositions(chain.map(N), chainEdges, "TB");
		const xs = chain.map((id) => at(p, id).x);
		const ys = chain.map((id) => at(p, id).y);
		expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(Math.max(...ys) - Math.min(...ys));
	});

	it("a long id truncated at the caller yields the SAME bounded width as a max-length node — the unbounded-nodeWidth lever is pinned", () => {
		const longId = `u${"A".repeat(200)}`;
		expect(nodeWidth(truncateLabel(longId))).toBe(nodeWidth("x".repeat(MAX_LABEL_CHARS)));
	});
});
