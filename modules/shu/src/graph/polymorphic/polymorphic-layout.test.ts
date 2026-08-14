/**
 * Where the nodes go, asserted without a browser.
 *
 * The graph library ran this simulation internally, so what the force views placed could only be read from a live
 * WebGL scene. Run here, the placing is an ordinary function over nodes and links: nodes spread apart, a linked pair
 * ends closer than an unlinked one, a pin holds, and the same input places the same way.
 */
import { describe, expect, it } from "vitest";
import { forceLayout } from "./polymorphic-layout.js";
import type { ForceContext } from "./force-layout.js";
import type { FGLink, FGNode } from "./polymorphic-graph-types.js";

const node = (id: string, at?: { x: number; y: number; z: number }): FGNode => ({ id, name: id, type: "Comment", ...at });
const context = (nodes: FGNode[], over: Partial<ForceContext> = {}): ForceContext => ({
	grouped: false,
	suppressesGrouping: false,
	groupBy: "type",
	anchors: new Map(),
	nodeMap: new Map(nodes.map((n) => [n.id, n])),
	lanePlacement: () => undefined,
	...over,
});
const gap = (a: FGNode, b: FGNode): number => Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));

describe("where a layout puts the nodes", () => {
	it("gives every node an x/y position, no two the same, and writes no node's z at all", () => {
		const nodes = ["a", "b", "c", "d"].map((id, i) => node(id, { x: 0, y: 0, z: i * 10 }));
		forceLayout(context(nodes)).place(nodes, []);
		for (const n of nodes) expect([n.x, n.y].every((v) => typeof v === "number" && Number.isFinite(v))).toBe(true);
		for (const a of nodes) for (const b of nodes) if (a !== b) expect(gap(a, b)).toBeGreaterThan(0);
		// z is the time axis, data-owned: the placement must leave it EXACTLY as given, not merely keep the differences.
		// d3-force-3d's forceCenter recentred z by the cloud's mean even at numDimensions(2) — a uniform shift the
		// relative check missed — so the camera framed a shifted cloud and the next merge's data z snapped it off frame.
		expect(nodes.map((n) => n.z)).toEqual([0, 10, 20, 30]);
	});

	it("leaves a pinned node where it is pinned, which is how a drag and a lane hold their nodes", () => {
		const held = { ...node("held"), fx: 120, fy: -40, x: 120, y: -40, z: 0 };
		const nodes = [held, node("a"), node("b")];
		forceLayout(context(nodes)).place(nodes, []);
		expect([held.x, held.y]).toEqual([120, -40]);
	});

	it("moves a damped placement's newcomers less than a full one, which is how a streamed clump stays readable", () => {
		const seeded = (): FGNode[] => ["a", "b", "c"].map((id, i) => node(id, { x: i * 4, y: 0, z: 0 }));
		const span = (nodes: FGNode[]): number => Math.max(...nodes.map((n) => Math.abs(n.x ?? 0)));
		const full = seeded();
		forceLayout(context(full)).place(full, []);
		const damped = seeded();
		forceLayout(context(damped)).place(damped, [], { damped: true });
		expect(span(damped)).toBeLessThan(span(full));
	});

	it("settles a linked pair closer together than an unlinked one, which is the spring doing its work", () => {
		const nodes = ["a", "b", "c", "d"].map((id) => node(id));
		const links: FGLink[] = [{ source: "a", target: "b", predicate: "narrate" }];
		forceLayout(context(nodes)).place(nodes, links);
		const [a, b, c, d] = nodes;
		expect(gap(a, b)).toBeLessThan(gap(c, d));
	});

	it("resolves each link's endpoints to node references, which is what positions the drawn lines", () => {
		// The library's forces are removed, so a placement is the one resolver of link endpoints.
		const nodes = ["a", "b"].map((id) => node(id));
		const links: FGLink[] = [{ source: "a", target: "b", predicate: "narrate" }];
		forceLayout(context(nodes)).place(nodes, links);
		expect(links[0].source).toBe(nodes[0]);
		expect(links[0].target).toBe(nodes[1]);
	});

	it("throws on a link naming a node that is not in the set, rather than drawing a line to nowhere", () => {
		const nodes = [node("a")];
		expect(() => forceLayout(context(nodes)).place(nodes, [{ source: "a", target: "missing", predicate: "narrate" }])).toThrow();
	});

	it("places the same graph the same way twice, so a repaint that changed nothing moves nothing", () => {
		const place = (): string => {
			const nodes = ["a", "b", "c"].map((id) => node(id, { x: 0, y: 0, z: 0 }));
			forceLayout(context(nodes)).place(nodes, [{ source: "a", target: "b", predicate: "narrate" }]);
			return nodes.map((n) => `${Math.round(n.x ?? 0)},${Math.round(n.y ?? 0)},${Math.round(n.z ?? 0)}`).join("|");
		};
		expect(place()).toBe(place());
	});
});
