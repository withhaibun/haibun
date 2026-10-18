import { describe, it, expect } from "vitest";
import { layeredLayout, PIXEL_METRICS } from "./layered-layout.js";
import type { TGraph } from "../../domains/graph.js";

const chain: TGraph = {
	nodes: [
		{ id: "a", label: "A" },
		{ id: "b", label: "B" },
		{ id: "c", label: "C" },
	],
	edges: [
		{ from: "a", to: "b" },
		{ from: "b", to: "c" },
	],
};

describe("layeredLayout", () => {
	it("lays a chain out in flow order along the layer axis (LR → increasing x)", () => {
		const out = layeredLayout({ ...chain, direction: "LR" }, PIXEL_METRICS);
		const ax = out.nodes.get("a")?.x ?? 0;
		const bx = out.nodes.get("b")?.x ?? 0;
		const cx = out.nodes.get("c")?.x ?? 0;
		expect(ax).toBeLessThan(bx);
		expect(bx).toBeLessThan(cx);
	});

	it("TB lays the same chain out top-to-bottom (increasing y), not by x", () => {
		const out = layeredLayout({ ...chain, direction: "TB" }, PIXEL_METRICS);
		expect((out.nodes.get("a")?.y ?? 0) < (out.nodes.get("b")?.y ?? 0)).toBe(true);
		expect((out.nodes.get("b")?.y ?? 0) < (out.nodes.get("c")?.y ?? 0)).toBe(true);
	});

	it("RL reverses the flow (a ends up to the right of c)", () => {
		const out = layeredLayout({ ...chain, direction: "RL" }, PIXEL_METRICS);
		expect((out.nodes.get("a")?.x ?? 0) > (out.nodes.get("c")?.x ?? 0)).toBe(true);
	});

	it("siblings in one layer stack on the cross axis without overlapping", () => {
		const branch: TGraph = {
			nodes: [
				{ id: "root", label: "root" },
				{ id: "x", label: "x" },
				{ id: "y", label: "y" },
			],
			edges: [
				{ from: "root", to: "x" },
				{ from: "root", to: "y" },
			],
			direction: "LR",
		};
		const out = layeredLayout(branch, PIXEL_METRICS);
		const x = out.nodes.get("x");
		const y = out.nodes.get("y");
		if (!x || !y) throw new Error("missing");
		expect(Math.round(x.x)).toBe(Math.round(y.x)); // same layer → same x band
		const overlap = y.y < x.y + x.h && x.y < y.y + y.h;
		expect(overlap).toBe(false);
	});

	it("a group box encloses its member nodes", () => {
		const g: TGraph = {
			nodes: [
				{ id: "a", label: "A", group: "G" },
				{ id: "b", label: "B", group: "G" },
				{ id: "out", label: "Out" },
			],
			edges: [{ from: "a", to: "b" }],
			groups: { G: { label: "Group" } },
			direction: "LR",
		};
		const out = layeredLayout(g, PIXEL_METRICS);
		const box = out.groups.find((x) => x.id === "G");
		const a = out.nodes.get("a");
		if (!box || !a) throw new Error("missing");
		expect(box.x).toBeLessThanOrEqual(a.x);
		expect(box.y).toBeLessThanOrEqual(a.y);
		expect(box.x + box.w).toBeGreaterThanOrEqual(a.x + a.w);
		expect(box.y + box.h).toBeGreaterThanOrEqual(a.y + a.h);
	});

	it("a parent group encloses its child group (nesting)", () => {
		const g: TGraph = { nodes: [{ id: "a", label: "A", group: "child" }], edges: [], groups: { parent: { label: "P" }, child: { label: "C", parent: "parent" } }, direction: "LR" };
		const out = layeredLayout(g, PIXEL_METRICS);
		const p = out.groups.find((x) => x.id === "parent");
		const c = out.groups.find((x) => x.id === "child");
		if (!p || !c) throw new Error("missing");
		expect(p.x).toBeLessThanOrEqual(c.x);
		expect(p.x + p.w).toBeGreaterThanOrEqual(c.x + c.w);
		expect(p.depth).toBeLessThan(c.depth);
	});
});

describe("the parts of a node", () => {
	/** A root with a part that has three parts of its own, and a leaf part beside it: each part points to its whole. */
	const parts: TGraph = {
		direction: "TB",
		nodes: ["root", "mid", "leaf", "a", "b", "c"].map((id) => ({ id, label: id })),
		edges: [{ from: "mid", to: "root" }, { from: "leaf", to: "root" }, ...["a", "b", "c"].map((from) => ({ from, to: "mid" }))],
	};

	it("take the layer next to their whole, however deep each part goes", () => {
		const out = layeredLayout(parts, PIXEL_METRICS);
		const y = (id: string): number | undefined => out.nodes.get(id)?.y;
		expect(y("leaf"), "a leaf part takes the layer of its sibling that has parts, not the deepest layer").toBe(y("mid"));
		expect(y("a")).not.toBe(y("mid"));
	});

	it("wrap into rows where one whole has more parts than a row holds, so the parts draw as a block under it", () => {
		const many: TGraph = {
			direction: "TB",
			nodes: [{ id: "whole", label: "whole" }, ...Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, label: "part" }))],
			edges: Array.from({ length: 20 }, (_, i) => ({ from: `p${i}`, to: "whole" })),
		};
		const out = layeredLayout(many, PIXEL_METRICS);
		const rows = new Set(Array.from({ length: 20 }, (_, i) => out.nodes.get(`p${i}`)?.y));
		const columns = new Set(Array.from({ length: 20 }, (_, i) => out.nodes.get(`p${i}`)?.x));
		expect(rows.size, "20 parts in rows of 8").toBe(3);
		expect(columns.size).toBe(8);
	});
});
