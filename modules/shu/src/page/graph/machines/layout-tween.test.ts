import { describe, expect, it } from "vitest";
import { LayoutTween } from "./layout-tween.js";
import type { FGNode, XYZ } from "../domains/graph-types.js";

const node = (id: string, x: number, y: number): FGNode => ({ id, name: id, type: "Comment", x, y, z: 7 });
const linear = (share: number): number => share;
const byId = (nodes: FGNode[]) => (id: string) => nodes.find((n) => n.id === id);

describe("a layout tween", () => {
	it("rewinds each node to its start, eases its pin toward its target, and leaves z to the data", () => {
		const nodes = [node("a", 10, 20)];
		const tween = new LayoutTween(100, linear);
		tween.begin(0, new Map<string, XYZ>([["a", { x: 0, y: 0, z: 7 }]]), nodes, null);
		expect([nodes[0]?.x, nodes[0]?.fx]).toEqual([0, 0]);
		expect(tween.step(50, byId(nodes))).toBe(false);
		expect([nodes[0]?.fx, nodes[0]?.fy, nodes[0]?.z]).toEqual([5, 10, 7]);
		expect(tween.step(100, byId(nodes))).toBe(true);
		expect([nodes[0]?.fx, nodes[0]?.fy]).toEqual([10, 20]);
	});

	it("translates the solved layout so the anchor node lands where it was", () => {
		const nodes = [node("a", 10, 10), node("b", 30, 10)];
		const tween = new LayoutTween(100, linear);
		tween.begin(0, new Map<string, XYZ>([["a", { x: 0, y: 0, z: 7 }]]), nodes, "a");
		tween.step(100, byId(nodes));
		expect(nodes.map((n) => [n.fx, n.fy])).toEqual([
			[0, 0],
			[20, 0],
		]);
	});

	it("rests each node at its target and keeps the pin only of a node the reader placed or chose", () => {
		const nodes = [node("a", 10, 10), node("b", 30, 10)];
		const tween = new LayoutTween(100, linear);
		tween.begin(0, new Map(), nodes, null);
		tween.finish(nodes, (id) => id === "b");
		expect(nodes.map((n) => [n.x, n.fx])).toEqual([
			[10, undefined],
			[30, 30],
		]);
		expect(tween.running).toBe(false);
	});

	it("refuses a node the layout didn't place", () => {
		expect(() => new LayoutTween(100, linear).begin(0, new Map(), [{ id: "a", name: "a", type: "Comment" }], null)).toThrow(/lacks a position/);
	});
});
