import { describe, it, expect } from "vitest";
import { layeredPositions, type LayeredDirection } from "../polymorphic/layered-solver.js";
import { collideRadius, chipTextHeight, truncateLabel, LAYERED_SIBLING_GAP } from "../polymorphic/layout-forces.js";

// The layered (td/lr) analogue of group-grid.test.ts: run the REAL solver, attach each node's REAL chip footprint
// (collideRadius half-width × chipTextHeight half-height), and assert the rendered layout is EXCLUSIVE (no two chips
// overlap) and COMPACT (siblings packed to the footprint, not over-spread). The chip is always
// a horizontal billboard, so its half-extents are {x: collideRadius, y: chipTextHeight} whatever the flow direction.
const half = (label: string) => ({ rx: collideRadius({ name: truncateLabel(label) }), ry: chipTextHeight({}) });

type Placed = { id: string; x: number; y: number; rx: number; ry: number };
const place = (nodes: ReadonlyArray<{ id: string; label: string }>, edges: ReadonlyArray<{ from: string; to: string }>, dir: LayeredDirection): Placed[] => {
	const pos = layeredPositions(
		nodes.map((n) => ({ id: n.id, label: truncateLabel(n.label) })),
		edges,
		dir,
	);
	return nodes.map((n) => {
		const p = pos.get(n.id);
		if (!p) throw new Error(`no position for ${n.id}`);
		const h = half(n.label);
		return { id: n.id, x: p.x, y: p.y, rx: h.rx, ry: h.ry };
	});
};

const overlapArea = (a: Placed, b: Placed): number => {
	const ox = Math.min(a.x + a.rx, b.x + b.rx) - Math.max(a.x - a.rx, b.x - b.rx);
	const oy = Math.min(a.y + a.ry, b.y + b.ry) - Math.max(a.y - a.ry, b.y - b.ry);
	return ox > 0 && oy > 0 ? ox * oy : 0;
};

// A root with four wide-label siblings in one rank (the trust-triangle parties + a long did:key) — the case the live
// td/lr view flings across the canvas.
const fan = {
	nodes: [
		{ id: "root", label: "Coastal Fisheries Authority" },
		{ id: "key", label: `did:key:${"z".repeat(120)}` },
		{ id: "reg", label: "Verifiable Data Registry" },
		{ id: "ver", label: "Port Inspection Service" },
		{ id: "hol", label: "Tidewater Aquatics Co-op" },
	],
	edges: [
		{ from: "root", to: "key" },
		{ from: "root", to: "reg" },
		{ from: "root", to: "ver" },
		{ from: "root", to: "hol" },
	],
};

for (const dir of ["TB", "LR"] as LayeredDirection[]) {
	describe(`layered ${dir}: nodes are exclusive + compact`, () => {
		it("no two node footprints overlap", () => {
			const placed = place(fan.nodes, fan.edges, dir);
			for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlapArea(placed[i], placed[j]), `${placed[i].id} ∩ ${placed[j].id}`).toBe(0);
		});

		it("siblings in a rank pack to the chip footprint, not over-spread", () => {
			const placed = place(fan.nodes, fan.edges, dir);
			// cross axis = x for TB (flow is y), y for LR (flow is x); the cross half-extent is collideRadius (x) or chipTextHeight (y)
			const crossOf = (p: Placed) => (dir === "TB" ? p.x : p.y);
			const crossHalf = (p: Placed) => (dir === "TB" ? p.rx : p.ry);
			const sibs = placed.filter((p) => p.id !== "root").sort((a, b) => crossOf(a) - crossOf(b));
			for (let i = 1; i < sibs.length; i++) {
				const gap = crossOf(sibs[i]) - crossOf(sibs[i - 1]);
				const bound = crossHalf(sibs[i]) + crossHalf(sibs[i - 1]) + LAYERED_SIBLING_GAP + 1e-6;
				expect(gap, `${sibs[i - 1].id}→${sibs[i].id} cross gap ${gap.toFixed(1)} should be ≤ ${bound.toFixed(1)}`).toBeLessThanOrEqual(bound);
			}
		});
	});
}
