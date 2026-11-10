import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_EGO_NEIGHBOURS, approximateChipWidth, computeEgoPositions, computeViewportFitScale, extractEgoGraph, type TEgoGraph } from "./ego-layout.js";
import type { FGLink, FGNode, XYZ } from "../domains/graph-types.js";

describe("ego-layout", () => {
	const centerNode: FGNode & XYZ = { id: "c0", name: "Center", type: "Email", x: 100, y: 50, z: 200 };
	const n1: FGNode & XYZ = { id: "n1", name: "Neighbour 1", type: "Person", x: 200, y: 150, z: 150 };
	const n2: FGNode & XYZ = { id: "n2", name: "Neighbour 2", type: "Note", x: -50, y: -20, z: 300 };

	const nodeMap = new Map<string, FGNode>([
		["c0", centerNode],
		["n1", n1],
		["n2", n2],
	]);

	it("extracts 1-hop neighbours and incident links without shifting", () => {
		const links: FGLink[] = [
			{ source: "c0", target: "n1", predicate: "sender" },
			{ source: "n2", target: "c0", predicate: "about" },
		];

		const ego = extractEgoGraph("c0", nodeMap, links, DEFAULT_MAX_EGO_NEIGHBOURS);
		expect(ego).toBeDefined();
		if (!ego) throw new Error("ego undefined");
		expect(ego.center).toBe(centerNode);
		expect(ego.neighbours).toHaveLength(2);
		expect(ego.neighbours[0]?.direction).toBe("out");
		expect(ego.neighbours[0]?.node.id).toBe("n1");
		expect(ego.neighbours[1]?.direction).toBe("in");
		expect(ego.neighbours[1]?.node.id).toBe("n2");
	});

	it("strictly preserves center coordinates and neighbour z (time axis)", () => {
		const ego: TEgoGraph = {
			center: centerNode,
			neighbours: [
				{ node: n1, link: { source: "c0", target: "n1", predicate: "sender" }, direction: "out" },
				{ node: n2, link: { source: "n2", target: "c0", predicate: "about" }, direction: "in" },
			],
			totalNeighbours: 2,
		};

		const scale = 0.5;
		const positions = computeEgoPositions(ego, scale);

		// Center is strictly identical
		expect(positions.center).toEqual({ x: 100, y: 50, z: 200 });

		// Neighbour z coordinates are strictly invariant!
		const p1 = positions.neighbours.find((n) => n.node.id === "n1");
		const p2 = positions.neighbours.find((n) => n.node.id === "n2");
		expect(p1?.pos.z).toBe(150);
		expect(p2?.pos.z).toBe(300);

		// Predicate positions exist and have valid coordinates
		expect(positions.neighbours[0]?.predicatePos).toBeDefined();
		expect(positions.neighbours[1]?.predicatePos).toBeDefined();
	});

	it("distributes clustered neighbours across available angular area without overlapping", () => {
		// Create 5 neighbours all clustered on the positive x axis in raw graph space
		const clusteredNeighbours = [1, 2, 3, 4, 5].map((i) => ({
			node: { id: `cl_${i}`, name: `Clustered ${i}`, type: "Item", x: 150 + i * 5, y: 50 + i * 2, z: 200 } as FGNode & XYZ,
			link: { source: "c0", target: `cl_${i}`, predicate: `rel_${i}` } as FGLink,
			direction: "out" as const,
		}));

		const ego: TEgoGraph = { center: centerNode, neighbours: clusteredNeighbours, totalNeighbours: 5 };

		const positions = computeEgoPositions(ego, 1.0);
		expect(positions.neighbours).toHaveLength(5);

		// Verify chips do not overlap each other
		for (let i = 0; i < positions.neighbours.length; i++) {
			const itemA = positions.neighbours[i];
			if (!itemA) continue;
			const posA = itemA.pos;
			const wA = approximateChipWidth(itemA.node.name);

			for (let j = i + 1; j < positions.neighbours.length; j++) {
				const itemB = positions.neighbours[j];
				if (!itemB) continue;
				const posB = itemB.pos;
				const wB = approximateChipWidth(itemB.node.name);

				const dx = Math.abs(posA.x - posB.x);
				const dy = Math.abs(posA.y - posB.y);
				const minX = (wA + wB) / 2;
				const minY = 4.2; // chip height

				// At least one dimension must clear to guarantee non-overlap
				const separated = dx >= minX || dy >= minY;
				expect(separated).toBe(true);
			}
		}

		// Verify predicate labels are distinct
		const predPositions = positions.neighbours.map((n) => n.predicatePos);
		for (let i = 0; i < predPositions.length; i++) {
			const pA = predPositions[i];
			if (!pA) continue;
			for (let j = i + 1; j < predPositions.length; j++) {
				const pB = predPositions[j];
				if (!pB) continue;
				const dist = Math.hypot(pA.x - pB.x, pA.y - pB.y);
				expect(dist).toBeGreaterThan(1.0);
			}
		}
	});

	it("computes scale factor to bring out-of-bounds neighbours into NDC viewport", () => {
		const distantNeighbour: FGNode & XYZ = { id: "far", name: "Far", type: "Page", x: 1000, y: 500, z: 200 };
		const ego: TEgoGraph = {
			center: centerNode,
			neighbours: [{ node: distantNeighbour, link: { source: "c0", target: "far", predicate: "links" }, direction: "out" }],
			totalNeighbours: 1,
		};

		const project = (p: XYZ) => ({ x: p.x / 200, y: p.y / 200, inFront: true });
		const scale = computeViewportFitScale(ego, project, 0.85);

		expect(scale).toBeLessThanOrEqual(1.0);
		expect(scale).toBeGreaterThan(0.01);

		const resultPositions = computeEgoPositions(ego, scale);
		const neighbourPos = resultPositions.neighbours[0]?.pos;
		expect(neighbourPos).toBeDefined();
		if (!neighbourPos) throw new Error("neighbourPos undefined");
		const ndc = project(neighbourPos);
		expect(Math.abs(ndc.x)).toBeLessThanOrEqual(0.86);
		expect(Math.abs(ndc.y)).toBeLessThanOrEqual(0.86);
	});
});
