import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FRAME, type FrameMove, type ReframeMode } from "../polymorphic/polymorphic-views.js";

/** Sole owner of camera CONTROL for the polymorphic view: every framing, viewport, and navigation move that mutates the
 * three.js camera + OrbitControls lives here, so "who decides the zoom" has one answer. The component keeps the leaf
 * refs (camera/controls/canvas/renderer/container — set late at scene-load and read by inspect/the drag/the compass)
 * and hands them in as accessors read at call time; this controller only READS them and is the only thing that moves
 * the camera. It also owns the load-time auto-fit state (the growth-gated frame that ends the moment the user takes
 * the camera) and the queued view-type re-aim. The decomposition's first subsystem (see lovely-finding-babbage). */

type Vec3 = { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
type Bbox = { x: [number, number]; y: [number, number]; z: [number, number] };

type FgCamera = {
	aspect: number;
	fov?: number;
	position?: { x: number; y: number; z: number };
	up?: Vec3; // the view's up vector — +y for every view except the sequence, which stands time (z) up
	updateProjectionMatrix(): void;
	updateMatrixWorld?(force?: boolean): void;
	matrixWorld?: { elements: number[] };
};
type FgRenderer = { setSize(w: number, h: number, updateStyle: boolean): void; getPixelRatio(): number; xr?: { isPresenting?: boolean } };
/** The placed-gantt extent the camera frames — computed by the active gantt view from its bars, kept out of here so
 *  the controller never reaches into render-type state. */
export type GanttExtent = { cy: number; cz: number; halfH: number; halfW: number };

/** Live refs + queries the component exposes; every getter is read at CALL time so a ref set late (scene-load) or a
 *  collection mutated each repaint (nodeMap) is always current — never copied. */
export type CameraDeps = {
	camera: () => FgCamera | undefined;
	controls: () => OrbitControls | undefined;
	container: () => HTMLElement | undefined;
	renderer: () => FgRenderer | undefined;
	canvas: () => HTMLCanvasElement | undefined;
	nodePositions: () => Iterable<{ x?: number; y?: number; z?: number }>;
	hasNodes: () => boolean;
	reframeMode: () => ReframeMode; // the active RenderType's camera aim — gantt looks down +x (time flat), front the default
	ganttExtent: () => GanttExtent | null;
	sequenceExtent: () => GanttExtent | null;
	refreshPickBounds: () => void;
};

/** A zoom step that would reach the target closes this fraction of what remains instead, so it never arrives. */
const ZOOM_APPROACH = 0.1;

/** Every camera write goes through this: a single non-finite coordinate bricks EVERY later move (each computes from the
 *  previous position), showing up as a camera that cannot zoom or pan and never recovers. Throwing names the culprit
 *  (a NaN node position, a zero-height container) at the write instead of leaving a silently stuck camera. */
function finite(move: string, values: Record<string, number>): void {
	for (const [name, value] of Object.entries(values)) {
		if (!Number.isFinite(value)) throw new Error(`camera ${move}: ${name} is ${value} — refusing a write that would leave the camera unable to move`);
	}
}

const azimuthOf = (refs: { t: Vec3; p: Vec3 } | null): number | null => (refs ? Math.atan2(refs.p.x - refs.t.x, refs.p.z - refs.t.z) : null);

type XYZ = { x: number; y: number; z: number };
const cross = (a: XYZ, b: XYZ): XYZ => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

type TRect = { left: number; top: number; right: number; bottom: number };

/**
 * Where a framing should aim when an overlay covers part of the canvas: the centre of the wider clear strip beside or
 * below the overlay, as a right/up pixel offset from the canvas centre. Null when nothing is occluded (centre is fine)
 * or when the overlay leaves no strip worth aiming at (nowhere better exists). Screen y grows downward, so a strip
 * below the canvas centre is a negative dyPx.
 */
export function clearStripOffset(canvas: TRect, overlay: TRect): { dxPx: number; dyPx: number } | null {
	// The overlay's edges clamped to the canvas: the strips are measured from where it actually ends on screen.
	const overlayRight = Math.min(overlay.right, canvas.right);
	const overlayBottom = Math.min(overlay.bottom, canvas.bottom);
	const overlapW = overlayRight - Math.max(overlay.left, canvas.left);
	const overlapH = overlayBottom - Math.max(overlay.top, canvas.top);
	if (overlapW <= 0 || overlapH <= 0) return null;
	const cx = (canvas.left + canvas.right) / 2;
	const cy = (canvas.top + canvas.bottom) / 2;
	const inX = overlay.left < cx && overlay.right > cx;
	const inY = overlay.top < cy && overlay.bottom > cy;
	if (!(inX && inY)) return null; // the overlay leaves the centre clear — an aimed node lands beside it already
	const rightW = canvas.right - overlayRight;
	const belowH = canvas.bottom - overlayBottom;
	if (rightW <= 0 && belowH <= 0) return null;
	// The wider strip wins: right of the overlay at the canvas's vertical centre, or below it at the horizontal centre.
	return rightW >= belowH ? { dxPx: (overlayRight + canvas.right) / 2 - cx, dyPx: 0 } : { dxPx: 0, dyPx: cy - (overlayBottom + canvas.bottom) / 2 };
}

/** An explicit camera aim: the target→camera direction and the up axis the fit establishes; "keep" preserves both. */
type Aim = "keep" | { dir: XYZ; up: XYZ };
const FRONT_AIM: Aim = { dir: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } }; // face the xy layout plane, upright
const LANE_AIM: Aim = { dir: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } }; // gantt: look along +x, z (time) reading left to right and y (the task rows) stacked
const SEQUENCE_AIM: Aim = { dir: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 0, z: -1 } }; // the same plane, quarter-turned: time reads DOWN and the lifelines stand, as a sequence diagram is read

export class PolymorphicCamera {
	private lastViewH = 0; // genuine viewport height baseline (onContainerResize only) — adjusts fov on a height change to hold the zoom level. Per-instance (resets on reload) so a transient boot height never seeds a wrong fov.
	private userControlled = false; // a zoom/pan/orbit gesture OR opening a node latches this — from then on only the user (or the fit button) re-frames; a hover never latches.
	private framedOnce = false; // the load-time auto-fit fires EXACTLY once (the warmup makes the first stop the final layout); a full clear rearms it.
	private pendingFrame: FrameMove | null = null;

	constructor(private deps: CameraDeps) {}

	/** Hand the camera to the user (a node open, exactly as a zoom/pan/orbit does) — ends the load-time auto-fit. */
	takeControl(): void {
		this.userControlled = true;
	}

	/** Queue a framing move to apply once the layout settles — a view re-aim on a view switch, or a fit pressed while
	 *  the layout still moves. Framing now would frame where the nodes are, not where they stop. */
	queueFrame(move: FrameMove | null): void {
		this.pendingFrame = move;
	}

	/**
	 * Re-assert the drawing buffer + camera ASPECT to the column box — aspect ONLY, never fov. The every-15-frame
	 * watchdog calls this, so when A-Frame transiently sizes the canvas to document.body the buffer is corrected
	 * without ever slipping in a fov change — worldPerPx ∝ tan(fov/2)/viewH, so a watchdog fov rewrite IS a zoom.
	 * Idempotent: no-ops unless the buffer drifted. Never touches lastViewH — that fov baseline belongs to the
	 * genuine-resize path alone, so a transient body-size can't corrupt it.
	 */
	syncViewport(): void {
		const c = this.deps.container();
		const r = this.deps.renderer();
		const cam = this.deps.camera();
		if (!c || !r || !cam || r.xr?.isPresenting) return;
		const w = c.clientWidth;
		const h = c.clientHeight;
		if (!w || !h) return;
		const pr = r.getPixelRatio();
		const want = Math.round(w * pr);
		const canvas = this.deps.canvas();
		if (canvas && canvas.width === want && canvas.height === Math.round(h * pr)) return;
		r.setSize(w, h, false);
		cam.aspect = w / h;
		cam.updateProjectionMatrix();
		this.deps.refreshPickBounds();
	}

	/**
	 * A genuine container resize — only the real ResizeObserver and the initial scene-load fire this. Preserve the
	 * zoom LEVEL across a HEIGHT change by tracking fov to height (worldPerPx ∝ tan(fov/2)/viewH, so fov ∝ height keeps
	 * it constant), so a sibling column or the actions bar resizing never silently rescales the graph; a WIDTH change
	 * stays aspect-only. lastViewH is the genuine-height baseline, updated only here — the per-frame watchdog can't
	 * move it, so a transient A-Frame body-size never seeds a wrong fov. Resets per instance on reload.
	 */
	onContainerResize(): void {
		const cam = this.deps.camera();
		const h = this.deps.container()?.clientHeight ?? 0;
		if (h && this.lastViewH && h !== this.lastViewH && this.deps.hasNodes() && cam?.fov) {
			cam.fov = (2 * Math.atan(Math.tan((cam.fov * Math.PI) / 180 / 2) * (h / this.lastViewH)) * 180) / Math.PI;
		}
		if (h) this.lastViewH = h;
		this.syncViewport();
	}

	/** World-space bounds of the live laid-out nodes, straight from the node positions (the authoritative simulation
	 *  positions) — NOT the lib's getGraphBbox, whose cached value is unreliable (it reported a near-collapsed extent
	 *  while the nodes were already spread, then overshot on the next render, so the camera framed empty space). */
	private nodeBounds(positions: Iterable<{ x?: number; y?: number; z?: number }> = this.deps.nodePositions()): Bbox | null {
		let minX = Number.POSITIVE_INFINITY,
			maxX = Number.NEGATIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY,
			maxY = Number.NEGATIVE_INFINITY;
		let minZ = Number.POSITIVE_INFINITY,
			maxZ = Number.NEGATIVE_INFINITY;
		for (const n of positions) {
			const x = n.x ?? 0,
				y = n.y ?? 0,
				z = n.z ?? 0;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
		}
		return Number.isFinite(minX) ? { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] } : null;
	}

	/** Half-diagonal of a bounds box (0 when null) — the single scalar that tells the auto-fit the graph has grown. */
	private boundsRadius(b: Bbox | null): number {
		return b ? Math.hypot((b.x[1] - b.x[0]) / 2, (b.y[1] - b.y[0]) / 2, (b.z[1] - b.z[0]) / 2) : 0;
	}

	/** The orbit target + camera position as mutable Vec3s (or null when controls aren't ready) — the shared preamble
	 *  for the framing/nav moves. The runtime objects are full three Vector3s; the local Vec3 type only declares set/x/y/z. */
	private orbitRefs(): { t: Vec3; p: Vec3 } | null {
		const controls = this.deps.controls();
		const t = controls?.target as Vec3 | undefined;
		const p = controls?.object.position as Vec3 | undefined;
		return controls && t && p ? { t, p } : null;
	}

	/** Execute one framing move — the ONE dispatcher every framing path funnels through: the fit button (via the render
	 *  type's view-relative `fitMove`), a queued view reframe, the load-time auto-fit, and the head's rotate control.
	 *  Every move shows every node: the lane frames (gantt/sequence) re-establish their canonical aim and roll over the
	 *  lane extent UNIONED with the node bounds, and report whether they applied (false until their bars are placed).
	 *  `fit` recentres on the node bounds and backs off ALONG THE CURRENT VIEW DIRECTION — a fit decides centre and
	 *  distance, never the orientation the user orbited to — while `front` and `side` reset the aim. */
	frame(move: FrameMove): boolean {
		if (move === FRAME.gantt) return this.frameLane(this.deps.ganttExtent(), LANE_AIM);
		if (move === FRAME.sequence) return this.frameLane(this.deps.sequenceExtent(), SEQUENCE_AIM);
		if (move === FRAME.side) this.fitBounds(this.nodeBounds(), LANE_AIM);
		else if (move === FRAME.front) this.fitBounds(this.nodeBounds(), FRONT_AIM);
		else this.fitBounds(this.nodeBounds(), "keep");
		return true;
	}

	/** Frame a subset of nodes by their positions — a node + its 1-hop neighbours, so a doc/tour step can jump straight to
	 *  a node's local context instead of the whole graph. Same orbit-preserving fit; a no-op for an empty/unknown set. */
	fitPositions(positions: Iterable<{ x?: number; y?: number; z?: number }>): void {
		this.fitBounds(this.nodeBounds(positions), "keep");
	}

	/** Look at `pos` from where the camera already is: the target slides to the point, the camera slides with it, so the
	 *  direction AND the distance are untouched. That is what following a node needs — the zoom level is the reader's,
	 *  and it must not change as the active node moves, or a label readable on one node is unreadable on the next.
	 *  `offsetPx` places the point that many pixels right/up of the canvas centre instead of at it — for a reader whose
	 *  centre is under an overlay, the clear part of the canvas is where "showing" happens. */
	centerOn(pos: { x?: number; y?: number; z?: number }, offsetPx?: { dxPx: number; dyPx: number }): void {
		const refs = this.orbitRefs();
		const x = pos.x ?? 0;
		const y = pos.y ?? 0;
		const z = pos.z ?? 0;
		if (!refs) return;
		finite("center", { x, y, z });
		const { t, p } = refs;
		// The target projects at the canvas centre, so aiming the point off-centre is aiming the target the same
		// distance the other way, along the camera's own screen axes (matrixWorld columns 0/1, as a pan reads them).
		// The matrix is forced current first: between a redraw's reframe and the next rendered frame it is stale, and
		// stale axes aim the offset along an orientation the camera no longer has (the pickNodeAt lesson).
		let ox = 0;
		let oy = 0;
		let oz = 0;
		if (offsetPx) {
			const cam = this.deps.camera();
			cam?.updateMatrixWorld?.(true);
			const m = cam?.matrixWorld?.elements;
			if (m) {
				const wpp = this.worldPerPxAt(pos) ?? 0;
				ox = (m[0] * offsetPx.dxPx + m[4] * offsetPx.dyPx) * wpp;
				oy = (m[1] * offsetPx.dxPx + m[5] * offsetPx.dyPx) * wpp;
				oz = (m[2] * offsetPx.dxPx + m[6] * offsetPx.dyPx) * wpp;
			}
		}
		finite("center offset", { ox, oy, oz });
		p.set(p.x + (x - ox - t.x), p.y + (y - oy - t.y), p.z + (z - oz - t.z));
		t.set(x - ox, y - oy, z - oz);
		this.deps.controls()?.update();
	}

	/** The target→camera unit vector, or the front default (+z) when the controls aren't live or the offset degenerates. */
	private viewDir(): XYZ {
		const refs = this.orbitRefs();
		const d = refs ? { x: refs.p.x - refs.t.x, y: refs.p.y - refs.t.y, z: refs.p.z - refs.t.z } : null;
		const len = d ? Math.hypot(d.x, d.y, d.z) : 0;
		return d && Number.isFinite(len) && len > 1e-9 ? { x: d.x / len, y: d.y / len, z: d.z / len } : { x: 0, y: 0, z: 1 };
	}

	/** The ONE fit kernel every framing move runs through: recentre on `bbox` and back the camera off along the view
	 *  direction — the current one for "keep", the explicit aim's otherwise (which also owns the roll: an explicit aim
	 *  writes its up axis, undoing the sequence's z-up). The box is projected onto the camera's screen axes, so one
	 *  formula frames ANY orientation: size the frustum to the projected lateral extent, then back off by the projected
	 *  half-depth so the nearest node clears the lens. At the front aim that reduces to the XY-extent + z-half-depth fit —
	 *  a node at the XY corner AND nearest z still projects inside, while a time-DEEP but XY-clustered graph fills the
	 *  view instead of shrinking to the z-inflated bounding sphere (the time axis fills its FULL depth for any date range,
	 *  so a 3D-radius fit made every multi-time graph a thin ribbon spanning a fraction of the view). */
	private fitBounds(bbox: Bbox | null, aim: Aim): void {
		const controls = this.deps.controls();
		const cam = this.deps.camera();
		if (!bbox || !controls || !cam) return;
		const center = { x: (bbox.x[0] + bbox.x[1]) / 2, y: (bbox.y[0] + bbox.y[1]) / 2, z: (bbox.z[0] + bbox.z[1]) / 2 };
		const half = { x: (bbox.x[1] - bbox.x[0]) / 2, y: (bbox.y[1] - bbox.y[0]) / 2, z: (bbox.z[1] - bbox.z[0]) / 2 };
		if (aim !== "keep") cam.up?.set(aim.up.x, aim.up.y, aim.up.z);
		const dir = aim !== "keep" ? aim.dir : this.viewDir();
		const up = aim !== "keep" ? aim.up : { x: cam.up?.x ?? 0, y: cam.up?.y ?? 1, z: cam.up?.z ?? 0 };
		let right = cross(up, dir);
		// A degenerate up (unset, or parallel to the view direction) can't span the screen plane — pick a world axis that can.
		if (Math.hypot(right.x, right.y, right.z) < 1e-6) right = cross(Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 }, dir);
		const rl = Math.hypot(right.x, right.y, right.z);
		right = { x: right.x / rl, y: right.y / rl, z: right.z / rl };
		const upv = cross(dir, right);
		const extent = (v: XYZ) => half.x * Math.abs(v.x) + half.y * Math.abs(v.y) + half.z * Math.abs(v.z);
		const vHalfFov = ((cam.fov ?? 80) * Math.PI) / 180 / 2;
		const hHalfFov = Math.atan(Math.tan(vHalfFov) * (cam.aspect ?? 1));
		const reach = Math.max(extent(right) / Math.tan(hHalfFov), extent(upv) / Math.tan(vHalfFov)) || 1;
		const distance = (extent(dir) + reach) * 1.1 + 20; // +20 floor keeps a degenerate single point off the lens
		finite("fit", { x: center.x, y: center.y, z: center.z, distance });
		controls.target.set(center.x, center.y, center.z);
		controls.object.position.set(center.x + dir.x * distance, center.y + dir.y * distance, center.z + dir.z * distance);
		controls.update();
	}

	/** Frame a lane view: its canonical aim (gantt upright, the sequence quarter-turned so time reads down) over the
	 *  placed lane extent, taken together with where the nodes actually are ON THE PLANE. A lane view places every node
	 *  it shows, so the extent and the bounds agree in the lane axis and time; only x — the axis the camera looks along —
	 *  is left out, since depth would inflate the frame and shrink the diagram to a speck.
	 *  False until the extent is placed — the caller keeps the move pending for the settle that has the placements. */
	private frameLane(ext: GanttExtent | null, aim: Aim): boolean {
		if (!ext) return false;
		// The extent is where the view PUT things; the node bounds are where they ended up. Union them ON THE PLANE only
		// (the lane axis and time), never across it: a lane view pins every node it shows to the plane, so the two agree
		// in y and z, while x is the axis the camera looks along — unioning that would let depth inflate the frame.
		const b = this.nodeBounds();
		const span = (lo: number, hi: number, other: [number, number] | undefined): [number, number] => (other ? [Math.min(lo, other[0]), Math.max(hi, other[1])] : [lo, hi]);
		this.fitBounds({ x: [0, 0], y: span(ext.cy - ext.halfH, ext.cy + ext.halfH, b?.y), z: span(ext.cz - ext.halfW, ext.cz + ext.halfW, b?.z) }, aim);
		return true;
	}

	/** Called on every engine stop. Frames EXACTLY ONCE, when the first real layout settles — the from-scratch warmup
	 *  makes that first stop the FINAL, converged layout, so one fit lands the whole graph and nothing needs re-fitting.
	 *  Never re-frames after settling (in non-flatten the z axis is TIME, which grows as data streams; a growth-driven
	 *  re-fit slid the camera along time and chased later reheats). A full clear lets it frame again; the user taking the camera
	 *  (or a running tween) suppresses it. */
	autoFitOnSettle(tweenActive: boolean): void {
		if (!this.deps.hasNodes()) {
			this.framedOnce = false; // a full clear restores the one-time fit for the next load
			return;
		}
		if (this.framedOnce || this.userControlled || tweenActive) return;
		// A lane view whose bars are not placed yet returns false; leave `framedOnce` unset so the next settle (which has
		// the placements) frames it, rather than burning the one-time fit on a no-op and leaving the view unframed.
		if (this.frame(this.deps.reframeMode())) this.framedOnce = true;
	}

	/** Apply a queued framing move (set in queueFrame) once the new layout has settled. A no-op when nothing is queued,
	 *  so it's safe to call on every settle. */
	applyPendingFrame(): void {
		if (!this.pendingFrame) return;
		// Keep the pending move if a lane frame no-ops (its extent is not computed yet); the next settle, which has the
		// placements, then applies it — an early settle before the data feed no longer consumes the aim as a no-op.
		if (this.frame(this.pendingFrame)) this.pendingFrame = null;
	}

	/**
	 * Move the camera toward or away from what it looks at. No limit on how near or far: a graph is laid out in whatever
	 * units its data implies, so a fixed floor is arbitrary. A world-unit floor stopped zoom-in dead, and since pan and
	 * orbit scale with the distance to the target, it starved those too.
	 *
	 * A step must not REACH the target (a camera on it has no direction to zoom back out along), so a step that would
	 * reach or pass it closes a fraction of what remains instead.
	 */
	zoomBy(amount: number, unit: "pixels" | "percent", dir: "in" | "out"): void {
		const refs = this.orbitRefs();
		if (!refs) return;
		this.userControlled = true; // the camera is now the user's — end the load-time auto-fit
		const { t, p } = refs;
		const ox = p.x - t.x,
			oy = p.y - t.y,
			oz = p.z - t.z;
		const dist = Math.hypot(ox, oy, oz) || 1;
		const delta = unit === "percent" ? dist * (amount / 100) : amount * (this.worldPerPxAt(t) ?? 1);
		const reached = dir === "in" ? dist - delta : dist + delta;
		const k = (reached > 0 ? reached : dist * ZOOM_APPROACH) / dist;
		finite("zoom", { k, x: t.x + ox * k, y: t.y + oy * k, z: t.z + oz * k });
		p.set(t.x + ox * k, t.y + oy * k, t.z + oz * k);
		this.deps.controls()?.update();
	}

	/** Slide the view (camera + target together, look direction unchanged). `pixels` = screen travel; `percent` = a
	 * fraction of the canvas width (left/right) or height (up/down). left/down translate negative along the screen axes. */
	panBy(amount: number, unit: "pixels" | "percent", dir: "left" | "right" | "up" | "down"): void {
		const m = this.deps.camera()?.matrixWorld?.elements;
		const refs = this.orbitRefs();
		if (!m || !refs) return;
		this.userControlled = true; // the camera is now the user's — end the load-time auto-fit
		const { t, p } = refs;
		const horizontal = dir === "left" || dir === "right"; // matrixWorld columns 0/1 are the camera's orthonormal right/up axes
		const ax = horizontal ? m[0] : m[4],
			ay = horizontal ? m[1] : m[5],
			az = horizontal ? m[2] : m[6];
		const dimPx = horizontal ? (this.deps.container()?.clientWidth ?? 0) : (this.deps.container()?.clientHeight ?? 0);
		const wpp = this.worldPerPxAt(t) ?? 1;
		const sign = dir === "left" || dir === "down" ? -1 : 1;
		const d = (unit === "percent" ? (amount / 100) * dimPx : amount) * wpp * sign;
		finite("pan", { d, ax, ay, az });
		t.set(t.x + ax * d, t.y + ay * d, t.z + az * d);
		p.set(p.x + ax * d, p.y + ay * d, p.z + az * d);
		this.deps.controls()?.update();
	}

	/** Orbit the camera around the target: left/right swing the azimuth (around world-up), up/down the pitch (around the
	 * camera's right axis). Rodrigues rotation of the camera→target offset by `degrees`. */
	orbitBy(degrees: number, dir: "left" | "right" | "up" | "down"): void {
		const m = this.deps.camera()?.matrixWorld?.elements;
		const refs = this.orbitRefs();
		if (!m || !refs) return;
		this.userControlled = true; // the camera is now the user's — end the load-time auto-fit
		const { t, p } = refs;
		const ox = p.x - t.x,
			oy = p.y - t.y,
			oz = p.z - t.z;
		const horizontal = dir === "left" || dir === "right";
		const kx = horizontal ? 0 : m[0],
			ky = horizontal ? 1 : m[1],
			kz = horizontal ? 0 : m[2]; // world-up for azimuth; camera-right for pitch (both unit)
		const angle = (dir === "left" || dir === "up" ? 1 : -1) * ((degrees * Math.PI) / 180);
		const c = Math.cos(angle),
			s = Math.sin(angle),
			dot = kx * ox + ky * oy + kz * oz;
		const crx = ky * oz - kz * oy,
			cry = kz * ox - kx * oz,
			crz = kx * oy - ky * ox;
		p.set(t.x + ox * c + crx * s + kx * dot * (1 - c), t.y + oy * c + cry * s + ky * dot * (1 - c), t.z + oz * c + crz * s + kz * dot * (1 - c));
		this.deps.controls()?.update();
	}

	/** World units per screen pixel at `pos` — the zoom signal. A function of fov, camera distance, AND viewport height. */
	worldPerPxAt(pos: { x?: number; y?: number; z?: number }): number | null {
		const cam = this.deps.camera();
		const viewH = this.deps.container()?.clientHeight ?? 0;
		if (!cam?.position || !viewH) return null;
		const dist = Math.hypot((pos.x ?? 0) - cam.position.x, (pos.y ?? 0) - cam.position.y, (pos.z ?? 0) - cam.position.z);
		const fov = ((cam.fov ?? 80) * Math.PI) / 180;
		return (2 * dist * Math.tan(fov / 2)) / viewH;
	}

	/** The zoom level + framing the eye sees, for inspect()/tests: world-per-pixel at the graph centre plus the canvas
	 * box. A column-open changes WIDTH (expected) but must never change HEIGHT or worldPerPx (auto-zoom). */
	zoomMetric(): { h: number; w: number; worldPerPx: number } | null {
		const worldPerPx = this.worldPerPxAt({ x: 0, y: 0, z: 0 });
		if (worldPerPx === null) return null;
		const c = this.deps.container();
		return { h: c?.clientHeight ?? 0, w: c?.clientWidth ?? 0, worldPerPx };
	}

	/** Azimuth of the camera around its target (radians) — a pan holds it, an orbit changes it. For inspect()/tests. */
	azimuth(): number | null {
		return azimuthOf(this.orbitRefs());
	}

	/** The point the camera looks at (the orbit target), for inspect()/tests — with `camera` position it names the aim. */
	targetPoint(): { x: number; y: number; z: number } | null {
		const refs = this.orbitRefs();
		return refs ? { x: refs.t.x, y: refs.t.y, z: refs.t.z } : null;
	}

	/** World-space half-diagonal of the laid-out graph — the camera-INDEPENDENT layout-spread signal, from the live node
	 *  positions (NOT the lib's getGraphBbox, which lags/overshoots). A test waits for THIS to stop growing to know the
	 *  layout (and so the auto-fit that follows it) has truly come to rest. */
	bboxRadius(): number {
		return this.boundsRadius(this.nodeBounds());
	}
}
