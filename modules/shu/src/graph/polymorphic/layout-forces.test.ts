/**
 * Headless layout-stability proof (pure d3-force-3d, no browser, ~ms). Reproduces the real jump: three-forcegraph
 * reheats the simulation (alpha→1) on every graphData feed, so an unpinned existing node re-settles when new data
 * arrives: that's the racy "graph jumps when I select / when data streams." And it proves the fix: pinning the
 * existing nodes across the feed holds them put while only the newcomer settles in. Uses the SAME forces the view does.
 */
import { describe, it, expect } from "vitest";
import { type Simulation, forceSimulation, forceManyBody, forceLink } from "d3-force-3d";
import { CHARGE, ALPHA_DECAY, VELOCITY_DECAY, collideForce, chipTextHeight, collideRadius, MAX_LABEL_CHARS, truncateLabel } from "./layout-forces.js";

type N = { id: string; name: string; x?: number; y?: number; fx?: number; fy?: number };
type L = { source: string; target: string };

const idOf = (d: N): string => d.id;

function settledSim(nodes: N[], links: L[]) {
	const sim: Simulation = forceSimulation(nodes)
		.numDimensions(2)
		.force("charge", forceManyBody().strength(CHARGE))
		.force("collide", collideForce())
		.force("link", forceLink(links).id(idOf))
		.velocityDecay(VELOCITY_DECAY)
		.alphaDecay(ALPHA_DECAY)
		.stop();
	for (let i = 0; i < 400; i++) sim.tick(); // settle to equilibrium
	return sim;
}

const baseNodes = (): N[] => Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, name: `node ${i}` }));
const baseLinks: L[] = [
	{ source: "n0", target: "n1" },
	{ source: "n1", target: "n2" },
	{ source: "n2", target: "n3" },
	{ source: "n0", target: "n4" },
];

/** Feed a new node+link and reheat (alpha→1, as three-forcegraph does), then run the data-settle ticks. */
function feedNewNode(sim: ReturnType<typeof settledSim>, nodes: N[], pinExisting: boolean): void {
	if (pinExisting) for (const n of nodes) (n.fx = n.x), (n.fy = n.y);
	nodes.push({ id: "new", name: "new node" });
	sim
		.nodes(nodes)
		.force("link", forceLink([...baseLinks, { source: "n0", target: "new" }]).id(idOf))
		.alpha(1);
	for (let i = 0; i < 40; i++) sim.tick(); // DATA_SETTLE_TICKS
}

const maxDrift = (nodes: N[], before: Map<string, { x: number; y: number }>, skip = ""): number => {
	let m = 0;
	for (const n of nodes) {
		if (n.id === skip) continue;
		const b = before.get(n.id);
		if (b) m = Math.max(m, Math.hypot((n.x ?? 0) - b.x, (n.y ?? 0) - b.y));
	}
	return m;
};

describe("polymorphic layout stability (headless d3-force-3d, no browser)", () => {
	it("REPRODUCES the jump: feeding a new node with a reheat moves the EXISTING (unpinned) nodes", () => {
		const nodes = baseNodes();
		const sim = settledSim(nodes, [...baseLinks]);
		const before = new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
		feedNewNode(sim, nodes, false);
		expect(maxDrift(nodes, before, "new"), "existing nodes move on a feed+reheat: the jump").toBeGreaterThan(1);
	});

	it("FIX: pinning the existing nodes across the feed holds them put, only the newcomer settles in", () => {
		const nodes = baseNodes();
		const sim = settledSim(nodes, [...baseLinks]);
		const before = new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
		feedNewNode(sim, nodes, true);
		expect(maxDrift(nodes, before, "new"), "pinned existing nodes hold across a feed").toBeLessThan(0.01);
	});
});

describe("label sizing: a long id can't inflate the chip or the footprint", () => {
	it("chipTextHeight is 3 for a chip, 4 for a cluster", () => {
		expect(chipTextHeight({})).toBe(3);
		expect(chipTextHeight({ isCluster: true })).toBe(4);
	});

	it("collideRadius grows linearly with the label length BELOW the cap", () => {
		expect(collideRadius({ name: "x".repeat(10) })).toBeCloseTo(3 * 0.6 + 10 * 3 * 0.28, 9);
	});

	it("collideRadius is BOUNDED at MAX_LABEL_CHARS, past the cap a longer id adds nothing", () => {
		const capped = collideRadius({ name: "x".repeat(MAX_LABEL_CHARS) });
		expect(collideRadius({ name: "x".repeat(200) })).toBe(capped);
		expect(capped).toBeCloseTo(3 * 0.6 + MAX_LABEL_CHARS * 3 * 0.28, 9);
	});

	it("truncateLabel caps the chip text at MAX_LABEL_CHARS with an ellipsis; a short label passes through verbatim", () => {
		expect(truncateLabel("short label")).toBe("short label");
		const longId = `u${"A".repeat(87)}`; // an 88-char base64-like @id
		const t = truncateLabel(longId);
		expect(t.length).toBe(MAX_LABEL_CHARS);
		expect(t.endsWith("…")).toBe(true);
	});
});
