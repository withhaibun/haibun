import { describe, it, expect } from "vitest";
import { layeredLayout } from "./layered-layout.js";
import type { TGraph } from "./types.js";

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
		const out = layeredLayout({ ...chain, direction: "LR" });
		const ax = out.nodes.get("a")?.x ?? 0;
		const bx = out.nodes.get("b")?.x ?? 0;
		const cx = out.nodes.get("c")?.x ?? 0;
		expect(ax).toBeLessThan(bx);
		expect(bx).toBeLessThan(cx);
	});

	it("TB lays the same chain out top-to-bottom (increasing y), not by x", () => {
		const out = layeredLayout({ ...chain, direction: "TB" });
		expect((out.nodes.get("a")?.y ?? 0) < (out.nodes.get("b")?.y ?? 0)).toBe(true);
		expect((out.nodes.get("b")?.y ?? 0) < (out.nodes.get("c")?.y ?? 0)).toBe(true);
	});

	it("RL reverses the flow (a ends up to the right of c)", () => {
		const out = layeredLayout({ ...chain, direction: "RL" });
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
		const out = layeredLayout(branch);
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
		const out = layeredLayout(g);
		const box = out.groups.find((x) => x.id === "G");
		const a = out.nodes.get("a");
		if (!box || !a) throw new Error("missing");
		expect(box.x).toBeLessThanOrEqual(a.x);
		expect(box.y).toBeLessThanOrEqual(a.y);
		expect(box.x + box.w).toBeGreaterThanOrEqual(a.x + a.w);
		expect(box.y + box.h).toBeGreaterThanOrEqual(a.y + a.h);
	});

	it("a parent group encloses its child group (nesting)", () => {
		const g: TGraph = {
			nodes: [{ id: "a", label: "A", group: "child" }],
			edges: [],
			groups: { parent: { label: "P" }, child: { label: "C", parent: "parent" } },
			direction: "LR",
		};
		const out = layeredLayout(g);
		const p = out.groups.find((x) => x.id === "parent");
		const c = out.groups.find((x) => x.id === "child");
		if (!p || !c) throw new Error("missing");
		expect(p.x).toBeLessThanOrEqual(c.x);
		expect(p.x + p.w).toBeGreaterThanOrEqual(c.x + c.w);
		expect(p.depth).toBeLessThan(c.depth);
	});
});
