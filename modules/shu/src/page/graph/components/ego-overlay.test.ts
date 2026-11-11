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

import { EgoOverlay, type EgoThree } from "./ego-overlay.js";
import { EGO_FADE_MS } from "../derivations/ego-fade.js";
import { MAX_EGO_NEIGHBOURS } from "../derivations/ego-layout.js";
import type { TSceneCamera } from "../ports.js";
import type { FGLink, FGNode, Obj3D, XYZ } from "../domains/graph-types.js";

/** The scene's projection in these tests: 50 world units from (10, 20) reach the viewport's edge. */
const ndcOf = (p: XYZ) => ({ x: (p.x - 10) / 50, y: (p.y - 20) / 50, z: 0.5 });
const disposed = { geometries: 0 };

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
			return ndcOf(this);
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
		dispose() {
			disposed.geometries++;
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

const RECT = { left: 0, top: 0, width: 1000, height: 800 };
const CAMERA = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } } as unknown as TSceneCamera;
const center: FGNode & XYZ = { id: "c1", name: "Center Node", type: "Email", x: 10, y: 20, z: 100 };
const node = (id: string, x: number): FGNode & XYZ => ({ id, name: `Node ${id}`, type: "Person", x, y: 20, z: 250 });

/** Returns an overlay over `neighbours` of the centre node, with a clock the test advances. */
function overlayOf(neighbours: Array<FGNode & XYZ>) {
	const clock = { at: 1000, now: () => clock.at };
	const overlay = new EgoOverlay({
		three: () => mockThree as unknown as EgoThree,
		parent: () => makePart(),
		camera: () => CAMERA,
		worldPerPxAt: () => 0.1,
		colors: () => ({ text: "#000", accent: "#00f", highlight: "#fc0", border: "#fff" }),
		markFor: (n) => ({ color: "#eee", type: n.type, kind: "chip", id: n.id, label: n.name, role: { kind: "free" } }),
		chipLabelOf: (n) => n.name,
		markDirty: vi.fn(),
		shownChanged: vi.fn(),
		clock,
	});
	const nodeMap = new Map<string, FGNode>([center, ...neighbours].map((n) => [n.id, n]));
	const links: FGLink[] = neighbours.map((n) => ({ source: center.id, target: n.id, predicate: "knows" }));
	const show = () => overlay.show(center, nodeMap, links, RECT);
	const advance = (ms: number) => {
		clock.at += ms;
		overlay.tick();
	};
	return { overlay, show, advance };
}

/** The client point just inside the chip that `overlay` shows first. */
function onFirstChip(overlay: EgoOverlay) {
	const chip = overlay.labels()[0];
	if (chip === undefined) throw new Error("the overlay doesn't show a chip");
	const ndc = ndcOf(chip.object.position);
	return { x: ((ndc.x + 1) / 2) * RECT.width + 5, y: ((1 - ndc.y) / 2) * RECT.height + 5 };
}

describe("EgoOverlay", () => {
	it("doesn't show for a node without neighbours", () => {
		const { overlay, show } = overlayOf([]);
		show();
		expect(overlay.isVisible).toBe(false);
	});

	it("doesn't show where every neighbour is on screen, since the scene draws them", () => {
		const { overlay, show } = overlayOf([node("in1", 30)]);
		show();
		expect(overlay.isVisible).toBe(false);
	});

	it("shows one off-screen neighbour as a chip and a predicate, fades in, and then rests", () => {
		const { overlay, show, advance } = overlayOf([node("n1", 400), node("in1", 30)]);
		show();
		expect(overlay.shown).toEqual({ center: "c1", neighbours: new Set(["n1"]) });
		expect(overlay.labels()).toHaveLength(2);
		expect(overlay.fading).toBe(true);
		advance(EGO_FADE_MS.in);
		expect(overlay.fading).toBe(false);
	});

	it("states the neighbours past the ones it shows as one count chip", () => {
		const many = Array.from({ length: MAX_EGO_NEIGHBOURS + 3 }, (_, i) => node(`n${i}`, 400 + i));
		const { overlay, show } = overlayOf(many);
		show();
		expect(overlay.labels()).toHaveLength(MAX_EGO_NEIGHBOURS * 2 + 1);
	});

	it("reverses a fade-out where the pointer returns to a chip, and stays shown", () => {
		const { overlay, show, advance } = overlayOf([node("n1", 400)]);
		show();
		advance(EGO_FADE_MS.in);
		const chip = onFirstChip(overlay);
		overlay.hide();
		advance(EGO_FADE_MS.out / 2);
		expect(overlay.testPointer(chip, RECT).kind).toBe("chip");
		advance(EGO_FADE_MS.in);
		expect(overlay.isVisible).toBe(true);
		expect(overlay.fading).toBe(false);
	});

	it("reads a pointer on a chip as that chip, and picks its neighbour", () => {
		const { overlay, show, advance } = overlayOf([node("n1", 400)]);
		show();
		advance(EGO_FADE_MS.in);
		expect(overlay.testPointer(onFirstChip(overlay), RECT)).toEqual({ kind: "chip", neighbourId: "n1" });
		expect(overlay.pickNeighbour(onFirstChip(overlay), RECT)?.id).toBe("n1");
	});

	it("releases its geometry once a fade-out ends", () => {
		const { overlay, show, advance } = overlayOf([node("n1", 400)]);
		show();
		advance(EGO_FADE_MS.in);
		const before = disposed.geometries;
		overlay.hide();
		advance(EGO_FADE_MS.out);
		expect(overlay.isVisible).toBe(false);
		expect(disposed.geometries - before, "the chip's frame and the spokes").toBe(2);
	});
});
