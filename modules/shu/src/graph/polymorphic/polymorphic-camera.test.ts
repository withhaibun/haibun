/**
 * PolymorphicCamera.frame(fit) frames a time-DEEP but XY-clustered graph usably. The time axis (z) normalizes to fill its
 * full depth for ANY date range, so a multi-time graph is always a deep ribbon; framing by the 3D bounding-sphere radius
 * backed the camera so far the graph filled only ~20% of the view (right at the "graph fits the view" threshold, so it
 * flaked). Sizing the frustum to the XY extent and backing off by the z half-depth frames it far tighter while still
 * keeping the nearest-z node in front of the lens. This pins the distance the fit lands on.
 */
import { describe, it, expect } from "vitest";
import { PolymorphicCamera, clearStripOffset, type CameraDeps } from "./polymorphic-camera.js";
import { FRAME, REFRAME, type ReframeMode } from "../polymorphic/polymorphic-views.js";

// Record the z the fit backs the camera to; the rest of the deps are inert stubs (only camera/controls/nodePositions
// are read by frame → fitBounds). fov 80, aspect 1 matches the fit math the test asserts.
function harness(nodes: Array<{ x: number; y: number; z: number }>) {
	let cameraZ = Number.NaN;
	const camera = { fov: 80, aspect: 1, updateProjectionMatrix: () => undefined, up: { x: 0, y: 0, z: 0, set: () => undefined } };
	const controls = {
		target: { set: () => undefined },
		object: {
			position: {
				set: (_x: number, _y: number, z: number) => {
					cameraZ = z;
				},
			},
		},
		update: () => undefined,
	};
	const deps: CameraDeps = {
		camera: () => camera as unknown as ReturnType<CameraDeps["camera"]>,
		controls: () => controls as unknown as ReturnType<CameraDeps["controls"]>,
		container: () => undefined,
		renderer: () => undefined,
		canvas: () => undefined,
		nodePositions: () => nodes,
		hasNodes: () => nodes.length > 0,
		reframeMode: () => REFRAME.front,
		ganttExtent: () => null,
		sequenceExtent: () => null,
		refreshPickBounds: () => undefined,
	};
	return { cam: new PolymorphicCamera(deps), getCameraZ: () => cameraZ };
}

/** A live target + position, as zooming needs them: zoomBy reads the offset between the two and rewrites the position. */
function zoomHarness(startZ: number) {
	const target = { x: 0, y: 0, z: 0, set: () => undefined };
	const position = {
		x: 0,
		y: 0,
		z: startZ,
		set(x: number, y: number, z: number) {
			this.x = x;
			this.y = y;
			this.z = z;
		},
	};
	const deps = {
		camera: () => ({ fov: 80, aspect: 1, position, updateProjectionMatrix: () => undefined }),
		controls: () => ({ target, object: { position }, update: () => undefined }),
		container: () => ({ clientHeight: 600, clientWidth: 800 }),
		renderer: () => undefined,
		canvas: () => undefined,
		nodePositions: () => [],
		hasNodes: () => true,
		reframeMode: () => REFRAME.front,
		ganttExtent: () => null,
		sequenceExtent: () => null,
		refreshPickBounds: () => undefined,
	} as unknown as CameraDeps;
	return { cam: new PolymorphicCamera(deps), distance: () => position.z };
}

describe("PolymorphicCamera.zoomBy: no limit on how near or far the camera goes", () => {
	it("keeps closing in past any fixed distance, so zooming in never stops working", () => {
		const { cam, distance } = zoomHarness(100);
		for (let i = 0; i < 40; i++) cam.zoomBy(50, "percent", "in");
		expect(distance()).toBeLessThan(0.001);
		expect(distance()).toBeGreaterThan(0);
	});

	it("never reaches what it looks at, so it can always zoom back out", () => {
		const { cam, distance } = zoomHarness(10);
		cam.zoomBy(100, "percent", "in"); // a step that would land exactly on the target
		expect(distance()).toBeGreaterThan(0);
		const closest = distance();
		cam.zoomBy(50, "percent", "out");
		expect(distance()).toBeGreaterThan(closest);
	});

	it("keeps backing off without bound", () => {
		const { cam, distance } = zoomHarness(1);
		for (let i = 0; i < 20; i++) cam.zoomBy(100, "percent", "out");
		expect(distance()).toBeGreaterThan(1000);
	});
});

describe("PolymorphicCamera.frame(fit), time-deep framing", () => {
	it("frames a z-deep, XY-clustered graph by its XY extent + z depth, not the loose 3D sphere", () => {
		// Tiny in XY (±1), deep in z ([0,400]): a wide date range. Centre z = 200, so the fit must back off past the
		// z half-depth (200) to keep the nearest-z node in front, but far LESS than the sphere fit (radius/sin(40°)+20 ≈
		// 331): which is what left the graph a thin ribbon.
		const { cam, getCameraZ } = harness([
			{ x: -1, y: 0, z: 0 },
			{ x: 1, y: 0, z: 400 },
			{ x: 0, y: 1, z: 200 },
			{ x: 0, y: -1, z: 200 },
		]);
		cam.frame(FRAME.fit);
		const distance = getCameraZ() - 200; // camera z minus the graph centre z
		expect(distance, "must clear the z half-depth so the nearest-z node is in front of the lens").toBeGreaterThan(200);
		expect(distance, "must be far tighter than the z-inflated sphere fit (~331) so the graph fills the view").toBeLessThan(300);
	});

	it("a flat, XY-spread graph frames on its XY extent (no spurious z push)", () => {
		// No z depth (halfD = 0): the distance is just the XY reach + breathing room + floor: the graph fills the view.
		const { cam, getCameraZ } = harness([
			{ x: -100, y: -100, z: 0 },
			{ x: 100, y: -100, z: 0 },
			{ x: 0, y: 100, z: 0 },
		]);
		cam.frame(FRAME.fit);
		const distance = getCameraZ() - 0;
		// XY reach = 100/tan(40°) ≈ 119; distance = 119*1.1 + 20 ≈ 151. No z term inflates it.
		expect(distance).toBeGreaterThan(120);
		expect(distance).toBeLessThan(200);
	});
});

/** A live target + position + up so the fit can read the orbit it must preserve; `camAt` places the camera pre-fit.
 *  `view` supplies a lane view's placed extent, so the lane frames are testable. */
function orbitedHarness(
	nodes: Array<{ x: number; y: number; z: number }>,
	camAt: { x: number; y: number; z: number },
	view?: { mode: ReframeMode; extent: { cy: number; cz: number; halfW: number; halfH: number } },
) {
	const vec = (x: number, y: number, z: number) => ({
		x,
		y,
		z,
		set(nx: number, ny: number, nz: number) {
			this.x = nx;
			this.y = ny;
			this.z = nz;
		},
	});
	const target = vec(0, 0, 0);
	const position = vec(camAt.x, camAt.y, camAt.z);
	const up = vec(0, 1, 0);
	const camera = { fov: 80, aspect: 1, up, position, updateProjectionMatrix: () => undefined };
	const deps = {
		camera: () => camera,
		controls: () => ({ target, object: { position }, update: () => undefined }),
		container: () => undefined,
		renderer: () => undefined,
		canvas: () => undefined,
		nodePositions: () => nodes,
		hasNodes: () => nodes.length > 0,
		reframeMode: () => view?.mode ?? REFRAME.front,
		ganttExtent: () => (view?.mode === REFRAME.gantt ? view.extent : null),
		sequenceExtent: () => (view?.mode === REFRAME.sequence ? view.extent : null),
		refreshPickBounds: () => undefined,
	} as unknown as CameraDeps;
	const viewDir = () => {
		const d = { x: position.x - target.x, y: position.y - target.y, z: position.z - target.z };
		const len = Math.hypot(d.x, d.y, d.z);
		return { x: d.x / len, y: d.y / len, z: d.z / len };
	};
	return { cam: new PolymorphicCamera(deps), target, position, up, viewDir };
}

describe("PolymorphicCamera.frame, fit keeps the user's orbit, the view aims reset it", () => {
	const nodes = [
		{ x: -100, y: -50, z: 0 },
		{ x: 100, y: 50, z: 400 },
	]; // centre (0, 0, 200)

	it("a fit recentres and re-sizes but keeps the view direction the user orbited to", () => {
		// Camera off to +x of its target: the user orbited a quarter-turn away from the front aim.
		const { cam, target, up, viewDir } = orbitedHarness(nodes, { x: 300, y: 0, z: 0 });
		const before = viewDir();
		cam.frame(FRAME.fit);
		expect(target, "the fit recentres on the node bounds").toMatchObject({ x: 0, y: 0, z: 200 });
		const after = viewDir();
		expect(after.x).toBeCloseTo(before.x, 6);
		expect(after.y).toBeCloseTo(before.y, 6);
		expect(after.z).toBeCloseTo(before.z, 6);
		expect(up, "a fit never touches the up axis").toMatchObject({ x: 0, y: 1, z: 0 });
	});

	it("the front aim resets to straight down +z, upright", () => {
		const { cam, target, position, up } = orbitedHarness(nodes, { x: 300, y: 120, z: -40 });
		cam.frame(FRAME.front);
		expect(target).toMatchObject({ x: 0, y: 0, z: 200 });
		expect(position.x, "front aim: no lateral offset").toBeCloseTo(0, 6);
		expect(position.y).toBeCloseTo(0, 6);
		expect(position.z, "the camera backs off down +z").toBeGreaterThan(200);
		expect(up).toMatchObject({ x: 0, y: 1, z: 0 });
	});

	it("the sequence frame restores the canonical lane plane from any orbit, over the PLACED extent", () => {
		// The user orbited away from the lane plane; a lane view has ONE canonical frame (fitMove routes its fit here):
		// look along +x with time reading DOWN, over the extent the view placed UNIONED WITH the node bounds on
		// the plane's own axes: the nodes are pinned to the plane, so y/z agree, while x (the axis the camera looks
		// along) is never unioned: depth would inflate the frame and shrink the diagram to a speck.
		// extent y [-70,0] ∪ nodes y [-50,50] → [-70,50]; extent z [0,240] ∪ nodes z [0,400] → [0,400].
		const { cam, target, position, up } = orbitedHarness(nodes, { x: 80, y: 200, z: 500 }, { mode: REFRAME.sequence, extent: { cy: -35, cz: 120, halfW: 120, halfH: 35 } });
		cam.frame(FRAME.sequence);
		expect(target, "recentred on the union, taken on the plane's own axes").toMatchObject({ x: 0, y: -10, z: 200 });
		expect(position.x, "the camera looks along +x from -x").toBeLessThan(0);
		expect(position.y).toBeCloseTo(-10, 6);
		expect(position.z).toBeCloseTo(200, 6);
		expect(up, "the sequence roll: time reads DOWN and the lifelines stand").toMatchObject({ x: 0, y: 0, z: -1 });
	});

	it("an orbited fit backs off far enough that the whole box fits the frustum from that angle", () => {
		// Viewed from +x, the z depth (±200) is the LATERAL screen extent and the x spread (±100) is the depth.
		// Required distance ≈ (200/tan(40°) + 100) * 1.1 + 20 ≈ 392, past the front fit's ≈371, since the long axis
		// now spans the screen.
		const { cam, position, viewDir } = orbitedHarness(nodes, { x: 300, y: 0, z: 0 });
		cam.frame(FRAME.fit);
		expect(viewDir()).toMatchObject({ x: 1, y: 0, z: 0 });
		expect(position.x, "the projected z-span sizes the distance from this angle").toBeGreaterThan(380);
		expect(position.x).toBeLessThan(430);
	});
});

describe("clearStripOffset, where a framing aims when an overlay covers the canvas centre", () => {
	const canvas = { left: 0, top: 0, right: 1000, bottom: 600 };

	it("aims at the strip right of a guide that covers the centre, at the canvas's vertical middle", () => {
		// The guide as it opens: top-left, 70% wide, 80% tall: the canvas centre (500, 300) is under it.
		const offset = clearStripOffset(canvas, { left: 20, top: 20, right: 700, bottom: 500 });
		expect(offset).toEqual({ dxPx: (700 + 1000) / 2 - 500, dyPx: 0 });
	});

	it("aims below a wide, short overlay, and screen-down is a negative dyPx", () => {
		const offset = clearStripOffset(canvas, { left: 0, top: 0, right: 990, bottom: 350 });
		expect(offset).toEqual({ dxPx: 0, dyPx: 300 - (350 + 600) / 2 });
	});

	it("leaves the aim alone when the overlay leaves the centre clear, or does not touch the canvas at all", () => {
		expect(clearStripOffset(canvas, { left: 0, top: 0, right: 300, bottom: 200 }), "a corner overlay occludes no centred node").toBeNull();
		expect(clearStripOffset(canvas, { left: 1200, top: 0, right: 1400, bottom: 600 }), "an overlay elsewhere on the page").toBeNull();
	});

	it("gives up when the overlay covers the whole canvas, nowhere clearer exists", () => {
		expect(clearStripOffset(canvas, { left: -10, top: -10, right: 1010, bottom: 610 })).toBeNull();
	});
});

describe("PolymorphicCamera.centerOn with an aim offset: the followed node lands in the clear strip", () => {
	/** A live orbit + an identity matrixWorld (camera on +z looking down -z: screen right = +x, screen up = +y). */
	function centreHarness() {
		const vec = (x: number, y: number, z: number) => ({
			x,
			y,
			z,
			set(nx: number, ny: number, nz: number) {
				this.x = nx;
				this.y = ny;
				this.z = nz;
			},
		});
		const target = vec(0, 0, 0);
		const position = vec(0, 0, 100);
		const camera = { fov: 80, aspect: 1, position, updateProjectionMatrix: () => undefined, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 100, 1] } };
		const deps = {
			camera: () => camera,
			controls: () => ({ target, object: { position }, update: () => undefined }),
			container: () => ({ clientHeight: 600, clientWidth: 1000 }),
			renderer: () => undefined,
			canvas: () => undefined,
			nodePositions: () => [],
			hasNodes: () => true,
			reframeMode: () => REFRAME.front,
			ganttExtent: () => null,
			sequenceExtent: () => null,
			refreshPickBounds: () => undefined,
		} as unknown as CameraDeps;
		return { cam: new PolymorphicCamera(deps), target, position };
	}

	it("without an offset the node IS the target, as following always centred", () => {
		const { cam, target } = centreHarness();
		cam.centerOn({ x: 5, y: -3, z: 0 });
		expect(target).toMatchObject({ x: 5, y: -3, z: 0 });
	});

	it("with an offset the target sits left of the node by world units equal to the offset, so the node projects right of centre", () => {
		const { cam, target, position } = centreHarness();
		cam.centerOn({ x: 0, y: 0, z: 0 }, { dxPx: 100, dyPx: 0 });
		// wpp at the node = 2·dist·tan(fov/2)/viewH = 2·100·tan(40°)/600; the target backs off -x by 100 px of it.
		const wpp = (2 * 100 * Math.tan((40 * Math.PI) / 180)) / 600;
		expect(target.x).toBeCloseTo(-100 * wpp, 6);
		expect(target.y).toBeCloseTo(0, 6);
		expect(position.x, "the camera slides with the target, so direction and distance hold").toBeCloseTo(-100 * wpp, 6);
		expect(position.z).toBeCloseTo(100, 6);
	});
});
