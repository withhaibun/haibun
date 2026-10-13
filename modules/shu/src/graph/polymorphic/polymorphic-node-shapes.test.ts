import { describe, it, expect } from "vitest";
import { paintMarkScene, boxShape, type NodeShapeDeps, type ShapeThree } from "./polymorphic-node-shapes.js";
import type { TTextAnchor } from "./polymorphic-troika-label.js";
import type { LabelVisual } from "../../page/graph/domains/graph-types.js";
import type { NodeMark } from "../../page/graph/domains/graph-scene.js";
import { GANTT_BAR_H, GANTT_BAR_D, GANTT_MIN_BAR_W, GANTT_LABEL_INSET } from "../../page/graph/derivations/gantt-layout.js";

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

// Recording stubs for THREE and the label factory: a 3D object is just numbers, so the paint's geometry (box dimensions,
// child offsets, colours) is asserted without a GPU. The scene injects the real AFRAME.THREE and makeTroikaText at runtime.
type RecBox = { geometry: { w: number; h: number; d: number }; material: { color: string }; renderOrder: number; children: unknown[] };
type RecLabel = LabelVisual & { anchor: TTextAnchor; height: number };

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

const harness = (): { deps: NodeShapeDeps; labels: RecLabel[] } => {
	const labels: RecLabel[] = [];
	const makeLabel = (text: string, height: number, color: string, anchor: TTextAnchor): LabelVisual => {
		const label: RecLabel = {
			object: { position: v3(), scale: v3(), renderOrder: 0 },
			text,
			color,
			opacity: 1,
			width: 0,
			faceCamera: () => undefined,
			dispose: () => undefined,
			anchor,
			height,
		};
		labels.push(label);
		return label;
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
	return { deps: { three, makeLabel, textColor: "#111", sceneTextColor: "#eee", borderColor: "#ccc", renderOrder: 20 }, labels };
};

describe("polymorphic paint (mark → three.js geometry, GPU-free)", () => {
	it("boxShape spans z by mark.zExtent (time is the z axis), its label at the start face in the scene colour", () => {
		const { deps, labels } = harness();
		const painted = boxShape(boxMark(40), deps);
		const box = painted.object as unknown as RecBox;
		expect(box.geometry).toMatchObject({ w: GANTT_BAR_D, h: GANTT_BAR_H, d: 40 }); // depth (z) = duration; thin on x
		expect(box.material.color).toBe("colour:Task");
		const [label] = labels;
		expect(painted.labels).toEqual([label]); // the scene turns it to the camera
		expect(box.children).toEqual([label?.object]);
		expect(label?.object.position.z).toBe(-20 + GANTT_LABEL_INSET); // inset from the bar's start (earliest-z) face
		expect(label?.color).toBe("#eee"); // off-chip text → the SCENE colour (white-on-black in dark), not the chip's dark
	});

	it("boxShape floors a tiny zExtent to the minimum bar length", () => {
		expect((boxShape(boxMark(0), harness().deps).object as unknown as RecBox).geometry.d).toBe(GANTT_MIN_BAR_W);
	});

	it("boxShape places a headerLabel upright, centred above the bar's start face (a sequence participant's name); default reads along the bar", () => {
		const along = harness();
		boxShape(boxMark(40), along.deps);
		expect(along.labels[0]?.anchor).toEqual({ x: "left", y: "middle" }); // gantt row: reading along the bar
		expect(along.labels[0]?.object.position.z).toBe(-20 + GANTT_LABEL_INSET);
		const header = harness();
		boxShape(boxMark(40), { ...header.deps, headerLabel: true });
		expect(header.labels[0]?.anchor).toEqual({ x: "center", y: "bottom" }); // the upright name caps the lifeline
		expect(header.labels[0]?.object.position.z).toBe(-20); // exactly at the start (earliest-z) face: the lifeline's top on screen
	});

	it("paintMarkScene dispatches by mark.kind, refuses a chip (a troika chip), and fails fast on an unimplemented kind", () => {
		const { deps } = harness();
		expect((paintMarkScene(boxMark(40), deps).object as unknown as RecBox).geometry.d).toBe(40);
		expect(() => paintMarkScene(chipMark(), deps)).toThrow(/troika chip/);
		expect(() => paintMarkScene(chipMark({ kind: "mesh" }), deps)).toThrow(/not implemented/);
	});
});
