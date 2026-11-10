import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_EGO_NEIGHBOURS, computeEgoPositions, computeViewportFitScale, extractEgoGraph, type TEgoGraph } from "./ego-layout.js";
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

	it("does not move neighbours that are already in the visible viewport", () => {
		// Visible neighbours placed close to center node (100, 50, 200) within viewport
		const visibleNeighbour1: FGNode & XYZ = { id: "vis1", name: "Visible 1", type: "Item", x: 110, y: 60, z: 200 };
		const visibleNeighbour2: FGNode & XYZ = { id: "vis2", name: "Visible 2", type: "Item", x: 90, y: 40, z: 210 };
		const ego: TEgoGraph = {
			center: centerNode,
			neighbours: [
				{ node: visibleNeighbour1, link: { source: "c0", target: "vis1", predicate: "rel1" }, direction: "out" },
				{ node: visibleNeighbour2, link: { source: "c0", target: "vis2", predicate: "rel2" }, direction: "out" },
			],
			totalNeighbours: 2,
		};

		// Project function showing both are well within NDC [-0.88, 0.88]
		const project = (p: XYZ) => ({ x: (p.x - 100) / 100, y: (p.y - 50) / 100, inFront: true });
		const positions = computeEgoPositions(ego, 0.5, { project });

		expect(positions.neighbours).toHaveLength(2);
		const p1 = positions.neighbours.find((n) => n.node.id === "vis1");
		const p2 = positions.neighbours.find((n) => n.node.id === "vis2");

		expect(p1?.isOffscreen).toBe(false);
		expect(p1?.pos).toEqual({ x: 110, y: 60, z: 200 });

		expect(p2?.isOffscreen).toBe(false);
		expect(p2?.pos).toEqual({ x: 90, y: 40, z: 210 });
	});

	it("pulls off-screen neighbours inward along edge curve to visible perimeter", () => {
		// Off-screen neighbours far outside the viewport
		const farNeighbour1: FGNode & XYZ = { id: "far1", name: "Far 1", type: "Item", x: 500, y: 350, z: 200 };
		const farNeighbour2: FGNode & XYZ = { id: "far2", name: "Far 2", type: "Item", x: -400, y: -250, z: 200 };
		const ego: TEgoGraph = {
			center: centerNode,
			neighbours: [
				{ node: farNeighbour1, link: { source: "c0", target: "far1", predicate: "rel1" }, direction: "out" },
				{ node: farNeighbour2, link: { source: "c0", target: "far2", predicate: "rel2" }, direction: "out" },
			],
			totalNeighbours: 2,
		};

		const project = (p: XYZ) => ({ x: (p.x - 100) / 200, y: (p.y - 50) / 200, inFront: true });
		const positions = computeEgoPositions(ego, 1.0, { project });

		const p1 = positions.neighbours.find((n) => n.node.id === "far1");
		const p2 = positions.neighbours.find((n) => n.node.id === "far2");

		expect(p1?.isOffscreen).toBe(true);
		expect(p2?.isOffscreen).toBe(true);

		if (!p1 || !p2) throw new Error("positions missing");

		// The perimeter position lies inside the NDC visible viewport
		const ndc1 = project(p1.pos);
		expect(Math.abs(ndc1.x)).toBeLessThanOrEqual(0.88);
		expect(Math.abs(ndc1.y)).toBeLessThanOrEqual(0.88);

		// Spoke points are sampled along the curve
		expect(p1.spokePoints.length).toBeGreaterThan(1);
		expect(p1.spokePoints[0]).toEqual({ x: centerNode.x, y: centerNode.y, z: centerNode.z });

		// When curvature is 0 (straight line), verify strict collinearity
		const straightPositions = computeEgoPositions(ego, 1.0, { project, curvature: 0 });
		const sp1 = straightPositions.neighbours.find((n) => n.node.id === "far1");
		if (!sp1) throw new Error("sp1 missing");
		const cross1 = (sp1.pos.x - centerNode.x) * (farNeighbour1.y - centerNode.y) - (sp1.pos.y - centerNode.y) * (farNeighbour1.x - centerNode.x);
		expect(Math.abs(cross1)).toBeLessThan(1e-4);
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

	it("relaxes adjacent off-screen perimeter chips so they never overlap", () => {
		const nA: FGNode & XYZ = { id: "col1", name: "LongFirstNeighbourTitle", type: "Person", x: 1000, y: 500, z: 200 };
		const nB: FGNode & XYZ = { id: "col2", name: "LongSecondNeighbourTitle", type: "Person", x: 1002, y: 501, z: 200 };
		const ego: TEgoGraph = {
			center: centerNode,
			neighbours: [
				{ node: nA, link: { source: "c0", target: "col1", predicate: "relA" }, direction: "out" },
				{ node: nB, link: { source: "c0", target: "col2", predicate: "relB" }, direction: "out" },
			],
			totalNeighbours: 2,
		};

		const project = (p: XYZ) => ({ x: (p.x - 100) / 200, y: (p.y - 50) / 200, inFront: true });
		const positions = computeEgoPositions(ego, 1.0, { project });

		const posA = positions.neighbours.find((n) => n.node.id === "col1")?.pos;
		const posB = positions.neighbours.find((n) => n.node.id === "col2")?.pos;

		if (!posA || !posB) throw new Error("positions missing");

		const dx = Math.abs(posB.x - posA.x);
		const dy = Math.abs(posB.y - posA.y);
		const minSeparation = 4.0; // at least one chip height of separation
		expect(dx > minSeparation || dy > minSeparation).toBe(true);
	});
});
