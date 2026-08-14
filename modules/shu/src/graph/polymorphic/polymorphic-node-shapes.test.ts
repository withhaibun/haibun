import { describe, it, expect } from "vitest";
import { paintMarkFisheye, chipShape, boxShape, type NodeShapeDeps, type ShapeLabel, type ShapeThree } from "./polymorphic-node-shapes.js";
import type { NodeMark } from "../graph-scene.js";
import { GANTT_BAR_H, GANTT_BAR_D, GANTT_MIN_BAR_W, GANTT_LABEL_INSET } from "../gantt-layout.js";

const chipMark = (over: Partial<NodeMark> = {}): NodeMark => ({ id: "a", type: "Person", kind: "chip", label: "Alice", color: "colour:Person", role: { kind: "free" }, ...over });
const boxMark = (zExtent: number, over: Partial<NodeMark> = {}): NodeMark => ({
	id: "t1",
	type: "Task",
	kind: "box",
	label: "Design",
	color: "colour:Task",
	zExtent,
	role: { kind: "time", start: 0, end: 1 },
	...over,
});

// Recording stubs for THREE + the label: a 3D object is just numbers, so the paint's geometry (box dimensions, child
// offsets, colours) is asserted with no GPU. The fisheye injects the real AFRAME.THREE + a SpriteText factory at runtime.
type RecBox = { geometry: { w: number; h: number; d: number }; material: { color: string }; renderOrder: number; children: RecLabel[]; add(o: unknown): void };
type RecLabel = ShapeLabel & { text: string; color: string };

const v3 = () => {
	const v = {
		x: 0,
		y: 0,
		z: 0,
		set: (x: number, y: number, z: number) => {
			v.x = x;
			v.y = y;
			v.z = z;
		},
	};
	return v;
};

const harness = (withThree = true): { deps: NodeShapeDeps; labels: RecLabel[] } => {
	const labels: RecLabel[] = [];
	const makeLabel = (text: string, _h: number, color: string): ShapeLabel => {
		const l = {
			position: v3(),
			scale: v3(),
			renderOrder: 0,
			add: (_o: unknown): void => undefined, // labels are leaves here; never receives children
			material: { depthTest: true, depthWrite: true },
			center: {
				x: 0,
				y: 0,
				set(x: number, y: number) {
					this.x = x;
					this.y = y;
				},
			},
			fontSize: 0,
			fontWeight: "",
			backgroundColor: "" as string | false,
			borderColor: "",
			borderWidth: 0,
			borderRadius: 0,
			padding: [] as number[],
			text,
			color,
		};
		labels.push(l);
		return l;
	};
	class BoxGeometry {
		constructor(
			public w: number,
			public h: number,
			public d: number,
		) {}
	}
	class MeshBasicMaterial {
		constructor(public params: Record<string, unknown>) {}
	}
	class Mesh {
		position = v3();
		scale = v3();
		renderOrder = 0;
		children: unknown[] = [];
		material: { color: string };
		geometry: { w: number; h: number; d: number };
		constructor(geometry: BoxGeometry, material: MeshBasicMaterial) {
			this.geometry = geometry;
			this.material = { color: String(material.params.color) };
		}
		add(o: unknown): void {
			this.children.push(o);
		}
	}
	const three = { Mesh, BoxGeometry, MeshBasicMaterial } as unknown as ShapeThree;
	return {
		deps: { three: withThree ? three : undefined, makeLabel, textColor: "#111", sceneTextColor: "#eee", borderColor: "#ccc", fontSize: 96, renderOrder: 20 },
		labels,
	};
};

describe("fisheye paint (mark → three.js geometry, GPU-free)", () => {
	it("chipShape paints the mark's colour as a centred chip billboard, depth-test off, on-chip text colour", () => {
		const chip = chipShape(chipMark(), harness().deps) as unknown as RecLabel;
		expect(chip.backgroundColor).toBe("colour:Person"); // the mark carries the colour (not a deps lookup)
		expect(chip.center.x).toBe(0.5); // centred on the node, so the focus magnifier grows it in place (no sideways drift)
		expect(chip.material.depthTest).toBe(false);
		expect(chip.color).toBe("#111"); // textColor (dark on the light chip), NOT the scene colour
	});

	it("boxShape spans z by mark.zExtent (time is the z axis), label at the start face in the scene colour", () => {
		const box = boxShape(boxMark(40), harness().deps) as unknown as RecBox;
		expect(box.geometry).toMatchObject({ w: GANTT_BAR_D, h: GANTT_BAR_H, d: 40 }); // depth (z) = duration; thin on x
		expect(box.material.color).toBe("colour:Task");
		expect(box.children.length).toBe(1);
		expect(box.children[0].position.z).toBe(-20 + GANTT_LABEL_INSET); // inset from the bar's start (earliest-z) face
		expect(box.children[0].position.x).toBe(0);
		expect(box.children[0].backgroundColor).toBe(""); // plain text, no chip frame
		expect(box.children[0].color).toBe("#eee"); // off-chip text → the SCENE colour (white-on-black in dark), not the chip's dark
	});

	it("boxShape floors a tiny zExtent to the minimum bar length", () => {
		expect((boxShape(boxMark(0), harness().deps) as unknown as RecBox).geometry.d).toBe(GANTT_MIN_BAR_W);
	});

	it("boxShape places a headerLabel upright, centred above the bar's start face (a sequence participant's name); default reads along the bar", () => {
		const along = boxShape(boxMark(40), harness().deps) as unknown as RecBox;
		expect(along.children[0].center.x).toBe(0); // gantt row: left-anchored, reading along the bar
		expect(along.children[0].center.y).toBe(0.5);
		expect(along.children[0].position.z).toBe(-20 + GANTT_LABEL_INSET);
		const header = boxShape(boxMark(40), { ...harness().deps, headerLabel: true }) as unknown as RecBox;
		expect(header.children[0].center.x).toBe(0.5); // bottom-centre anchor → the upright name caps the lifeline
		expect(header.children[0].center.y).toBe(0);
		expect(header.children[0].position.z).toBe(-20); // exactly at the start (earliest-z) face — the lifeline's top on screen
	});

	it("boxShape falls back to a chip with no THREE (headless)", () => {
		expect((boxShape(boxMark(40), harness(false).deps) as unknown as RecLabel).backgroundColor).toBe("colour:Task");
	});

	it("paintMarkFisheye dispatches by mark.kind and fails fast on an unimplemented kind", () => {
		const { deps } = harness();
		expect((paintMarkFisheye(boxMark(40), deps) as unknown as RecBox).geometry.d).toBe(40);
		expect((paintMarkFisheye(chipMark(), deps) as unknown as RecLabel).backgroundColor).toBe("colour:Person");
		expect(() => paintMarkFisheye(chipMark({ kind: "mesh" }), deps)).toThrow(/not implemented/);
	});
});
