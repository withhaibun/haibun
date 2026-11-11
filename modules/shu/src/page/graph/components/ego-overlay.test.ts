import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

const originalDocument = globalThis.document;

beforeAll(() => {
	globalThis.document = {
		createElement: () => ({ width: 0, height: 0, getContext: () => ({ createRadialGradient: () => ({ addColorStop: () => undefined }), fillRect: () => undefined }) }),
	} as unknown as Document;
});

afterAll(() => {
	globalThis.document = originalDocument;
});

const landings: (() => void)[] = [];
vi.mock("troika-three-text", () => ({
	configureTextBuilder: () => undefined,
	Text: class {
		material = {};
		position = { x: 0, y: 0, z: 0, set: (x: number, y: number, z: number) => undefined };
		textRenderInfo = { blockBounds: [0, -1, 4, 0] };
		sync(landed: () => void) {
			landings.push(landed);
		}
		dispose() {
			/* noop */
		}
	},
}));

import { EgoOverlay } from "./ego-overlay.js";
import type { FGLink, FGNode, Obj3D, XYZ } from "../domains/graph-types.js";

function makePart(): Obj3D & { add: () => void; remove: () => void; computeLineDistances: () => void } {
	return {
		renderOrder: 0,
		scale: { x: 1, y: 1, z: 1, set: () => undefined },
		position: {
			x: 0,
			y: 0,
			z: 0,
			set: function (this: { x: number; y: number; z: number }, x: number, y: number, z: number) {
				this.x = x;
				this.y = y;
				this.z = z;
			},
		},
		material: { opacity: 1, transparent: true },
		add: () => undefined,
		remove: () => undefined,
		computeLineDistances: () => undefined,
	};
}

function makeVector3(x = 0, y = 0, z = 0) {
	return {
		x,
		y,
		z,
		set(nx: number, ny: number, nz: number) {
			this.x = nx;
			this.y = ny;
			this.z = nz;
		},
		project() {
			const ndcX = this.x > 10 ? 0.8 : this.x < 10 ? -0.8 : 0.0;
			return { x: ndcX, y: 0.0, z: 0.5 };
		},
	};
}

const mockThree = {
	Group: makePart,
	Mesh: makePart,
	PlaneGeometry: makePart,
	CanvasTexture: class {},
	Sprite: makePart,
	SpriteMaterial: class {},
	MeshBasicMaterial: class {
		opacity = 1;
		transparent = true;
	},
	BufferGeometry: class {
		setAttribute() {
			/* noop */
		}
		setFromPoints() {
			return this;
		}
		dispose() {
			/* noop */
		}
	},
	Float32BufferAttribute: class {},
	LineSegments: makePart,
	LineLoop: makePart,
	LineBasicMaterial: class {
		opacity = 1;
		transparent = true;
		dispose() {
			/* noop */
		}
	},
	LineDashedMaterial: class {
		opacity = 1;
		transparent = true;
		dispose() {
			/* noop */
		}
	},
	Vector3: makeVector3,
};

describe("EgoOverlay", () => {
	const center: FGNode & XYZ = { id: "c1", name: "Center Node", type: "Email", x: 10, y: 20, z: 100 };
	const neighbour: FGNode & XYZ = { id: "n1", name: "Neighbour Node", type: "Person", x: 50, y: 80, z: 250 };

	const nodeMap = new Map<string, FGNode>([
		["c1", center],
		["n1", neighbour],
	]);
	const links: FGLink[] = [{ source: "c1", target: "n1", predicate: "from" }];

	it("anchors central ego chip at identical (x0, y0, z0) and preserves neighbour z (time)", () => {
		const parentGroup = makePart();
		const parentAdd = vi.fn();
		parentGroup.add = parentAdd;

		let mockTime = 1000;
		const overlay = new EgoOverlay({
			three: () => mockThree,
			parent: () => parentGroup,
			camera: () => ({}),
			colors: () => ({ text: "#000", accent: "#00f", highlight: "#fc0", border: "#fff" }),
			markFor: (n) => ({ color: "#eee", type: n.type, kind: "chip", id: n.id, label: n.name, role: { kind: "free" } }),
			chipLabelOf: (n) => n.name,
			markDirty: vi.fn(),
			clock: {
				now: () => mockTime,
				frame: (cb) => {
					mockTime += 200;
					cb();
					return () => undefined;
				},
			},
		});

		overlay.show(center, nodeMap, links);
		expect(parentAdd).toHaveBeenCalled();
		expect(overlay.activeCenterId).toBe("c1");
		expect(overlay.isVisible).toBe(true);

		// Animate forward to completion
		mockTime += 200;

		const rect = { left: 0, top: 0, width: 1000, height: 800 };
		const centerHit = overlay.testPointer({ x: 500, y: 400 }, rect);
		expect(centerHit.kind).toBe("center");

		const spokeHit = overlay.testPointer({ x: 700, y: 405 }, rect);
		expect(spokeHit.kind).toBe("spoke");
		if (spokeHit.kind === "spoke") {
			expect(spokeHit.neighbourId).toBe("n1");
		}

		const chipHit = overlay.testPointer({ x: 910, y: 400 }, rect);
		expect(chipHit.kind).toBe("chip");
		if (chipHit.kind === "chip") {
			expect(chipHit.neighbourId).toBe("n1");
		}

		// Virtual chip right half and bottom span should also register hit
		const chipRightHit = overlay.testPointer({ x: 950, y: 410 }, rect);
		expect(chipRightHit.kind).toBe("chip");

		const picked = overlay.pickNeighbour({ x: 950, y: 410 }, rect);
		expect(picked?.id).toBe("n1");

		overlay.hide();
		mockTime += 200;
		expect(overlay.isVisible).toBe(false);
	});

	it("retains visibility when hovering a virtual neighbour during hide", () => {
		const parentGroup = makePart();
		let mockTime = 1000;
		let pendingFrame: (() => void) | undefined;
		const overlay = new EgoOverlay({
			three: () => mockThree,
			parent: () => parentGroup,
			camera: () => ({}),
			colors: () => ({ text: "#000", accent: "#00f", highlight: "#fc0", border: "#fff" }),
			markFor: (n) => ({ color: "#eee", type: n.type, kind: "chip", id: n.id, label: n.name, role: { kind: "free" } }),
			chipLabelOf: (n) => n.name,
			markDirty: vi.fn(),
			clock: {
				now: () => mockTime,
				frame: (cb) => {
					pendingFrame = cb;
					return () => undefined;
				},
			},
		});

		overlay.show(center, nodeMap, links);
		expect(overlay.isVisible).toBe(true);

		mockTime += 400;
		pendingFrame?.();

		overlay.hide();
		expect(overlay.isVisible).toBe(true);

		// Hovering virtual neighbour chip cancels hide and keeps visible
		const rect = { left: 0, top: 0, width: 1000, height: 800 };
		const hit = overlay.testPointer({ x: 950, y: 410 }, rect);
		expect(hit.kind).toBe("chip");

		mockTime += 500;
		pendingFrame?.();
		expect(overlay.isVisible).toBe(true);
	});

	it("does not create duplicate virtual chips for neighbours already in the visible viewport", () => {
		const parentGroup = makePart();
		const parentAdd = vi.fn();
		parentGroup.add = parentAdd;

		const inViewportNeighbour: FGNode & XYZ = { id: "in1", name: "In Viewport", type: "Person", x: 15, y: 25, z: 100 };
		const localNodeMap = new Map<string, FGNode>([
			["c1", center],
			["in1", inViewportNeighbour],
		]);
		const localLinks: FGLink[] = [{ source: "c1", target: "in1", predicate: "knows" }];

		let localTime = 1000;
		const overlay = new EgoOverlay({
			three: () => mockThree,
			parent: () => parentGroup,
			camera: () => ({ position: { x: 10, y: 20, z: 300 }, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } }),
			colors: () => ({ text: "#000", accent: "#00f", highlight: "#fc0", border: "#fff" }),
			markFor: (n) => ({ color: "#eee", type: n.type, kind: "chip", id: n.id, label: n.name, role: { kind: "free" } }),
			chipLabelOf: (n) => n.name,
			markDirty: vi.fn(),
			clock: {
				now: () => localTime,
				frame: (cb) => {
					localTime += 200;
					cb();
					return () => undefined;
				},
			},
		});

		overlay.show(center, localNodeMap, localLinks);
		expect(overlay.isVisible).toBe(true);

		// Labels returned by overlay should NOT contain virtual chips for in-viewport nodes
		expect(overlay.labels()).toHaveLength(0);

		// But corridor tracking still recognizes the in-viewport target position
		const rect = { left: 0, top: 0, width: 1000, height: 800 };
		const hit = overlay.testPointer({ x: 900, y: 400 }, rect);
		expect(hit.kind).toBe("chip");
		if (hit.kind === "chip") {
			expect(hit.neighbourId).toBe("in1");
		}
	});

	it("animates virtual chips from their current graph position rather than the ego node", () => {
		const parentGroup = makePart();
		const offscreenNeighbour: FGNode & XYZ = { id: "off1", name: "Offscreen", type: "Person", x: 600, y: 400, z: 100 };
		const localNodeMap = new Map<string, FGNode>([
			["c1", center],
			["off1", offscreenNeighbour],
		]);
		const localLinks: FGLink[] = [{ source: "c1", target: "off1", predicate: "knows" }];

		let mockTime = 1000;
		const overlay = new EgoOverlay({
			three: () => mockThree,
			parent: () => parentGroup,
			camera: () => ({ position: { x: 10, y: 20, z: 300 }, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } }),
			colors: () => ({ text: "#000", accent: "#00f", highlight: "#fc0", border: "#fff" }),
			markFor: (n) => ({ color: "#eee", type: n.type, kind: "chip", id: n.id, label: n.name, role: { kind: "free" } }),
			chipLabelOf: (n) => n.name,
			markDirty: vi.fn(),
			clock: {
				now: () => mockTime,
				frame: (cb) => {
					mockTime += 200;
					cb();
					return () => undefined;
				},
			},
		});

		overlay.show(center, localNodeMap, localLinks);
		expect(overlay.isVisible).toBe(true);
	});
});
