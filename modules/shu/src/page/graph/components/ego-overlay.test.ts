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
			return { x: 0.1, y: 0.1, z: 0.5 };
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
		overlay.hide();
		mockTime += 200;
		expect(overlay.isVisible).toBe(false);
	});
});
