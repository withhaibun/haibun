// The polymorphic's focus subsystem: the whole purely-visual dim/highlight + the focus-chip MAGNIFY pop. It decides what is
// focused (the open column's node, else the hovered node), dims every node/edge/label except the focus neighbourhood,
// re-pools the lib's per-link colours so a line's rgba carries its focus-state opacity, and animates the focus node's
// chip up to a readable on-screen size with the cartoon easeOutBack overshoot. Nothing here moves the layout: at rest
// it pins still-free nodes first (via the injected pin sink) so the lib's colour re-pool tick cannot jump an
// under-converged force layout: the engine-settle guard. SELECT/hover-only focus, never a viewType branch.
//
// Wired like PolymorphicCamera/DataPipeline: constructor-injected accessor deps read at CALL time, so a late-bound graph
// instance, a per-repaint-refreshed nodeMap, or a theme-recoloured colour field is always current; the component still
// OWNS those, this controller only reads them and owns the magnify animation state. (lovely-finding-babbage.)

import { focusStateFor, opacityFor, isFullContrast, type FocusState, type KindTiers } from "../focus-policy.js";
import { type FGNode, type FGLink, type TSprite, type ThreeObj, linkEndId } from "./polymorphic-graph-types.js";
import { chipTextHeight } from "./layout-forces.js";
import { NEWCOMER_GLOW_MS, RESTING_INTENSITY, glowColorAt, pulseAt } from "./polymorphic-highlight.js";

// three-forcegraph forces link objects to renderOrder 10; draw nodes above that (edges sit behind), labels between.
export const NODE_RENDER_ORDER = 20;
export const FOCUS_RENDER_ORDER = 21; // the magnified chip is never occluded by its peers

// Focus magnifier: a focused chip pops UP TO a readable on-screen text size, and ONLY when that's a MODEST step.
// readableK wants `targetPx·worldPerPx/textHeight`: on a zoomed-out graph that's a big multiplier, which would blow the
// connected nodes up to dominate the whole graph ("the hover pops everything huge"). So the pop is bounded to MAX_MAGNIFY:
// a node already at/above readable is left alone, a node a modest step below pops to readable, and a node so small it
// would need MORE than MAX_MAGNIFY to read is LEFT AS-IS (zoom in to read it) rather than enlarged into a huge blob.
const MAX_MAGNIFY = 1.4; // the focus pop never enlarges a chip beyond this, kept low so that, on a z-deep graph (camera backed off, so readableK wants a large multiplier), the focus set pops only gently rather than dominating the view; a chip needing more is left small (zoom in to read it). Tune here.
const MAGNIFY_MS = 500;
export const NODE_FONT_SIZE = 96;
const MAX_FONT_SIZE = 384;
const PULSE_AMP = 0.1; // already readable → no resize, just an acknowledgement pop up and back

/** easeOutBack with a gentle overshoot: the chip eases past its target and settles. */
const easeOutBack = (t: number): number => {
	const c1 = 1.2;
	const c3 = c1 + 1;
	return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

/** Normalise any CSS colour to an "r,g,b" triplet (cached) so a per-link rgba() can carry the focus-state alpha
 *  through the lib's colour-alpha line-opacity path (line opacity = global linkOpacity × the colour's alpha). */
const rgbTriplet = (() => {
	let ctx: CanvasRenderingContext2D | null | undefined;
	const cache = new Map<string, string>();
	return (color: string): string => {
		const hit = cache.get(color);
		if (hit !== undefined) return hit;
		if (ctx === undefined) ctx = document.createElement("canvas").getContext("2d");
		let triplet = "136,136,136";
		if (ctx) {
			ctx.fillStyle = "#000";
			ctx.fillStyle = color; // the canvas normalises any CSS colour to "#rrggbb" or "rgba(r, g, b, a)"
			const norm = ctx.fillStyle;
			if (norm.startsWith("#")) {
				const n = Number.parseInt(norm.slice(1), 16);
				triplet = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
			} else {
				const m = norm.match(/\d+/g);
				if (m && m.length >= 3) triplet = `${m[0]},${m[1]},${m[2]}`;
			}
		}
		cache.set(color, triplet);
		return triplet;
	};
})();

/** Set transparency on a three object and its children (link group = line + label sprite). Nodes dim through their
 *  NodeVisual (see applyFocus); this covers the edge lines + labels + enclosures, which are plain sprites/meshes. */
const setOpacityDeep = (obj: ThreeObj | undefined, opacity: number): void => {
	if (!obj) return;
	if (obj.material) {
		obj.material.transparent = true;
		obj.material.opacity = opacity;
	}
	if (obj.children) for (const c of obj.children) setOpacityDeep(c, opacity);
};

/** A group enclosure's adjustable materials + label: the focus dim touches these exactly as it dims a node. */
type FocusEnclosure = { boxMat: { opacity: number }; edgeMat: { opacity: number }; label: TSprite };

/** The graph-lib slice the focus re-pools through (per-link colour + arrow colour). */
type FocusGraph = { linkColor(fn: (l: FGLink) => string): unknown; linkDirectionalArrowColor(fn: (l: FGLink) => string): unknown };

/** Accessors the component supplies; every getter is read at CALL time so a late-bound graph ref, a per-repaint
 *  nodeMap, or a theme-recoloured colour field is always current, never copied. */
export type FocusDeps = {
	focusId: () => string | null; // selected (sticky, column open) else hover (transient)
	selectedId: () => string | null; // the ACTIVE node alone (never a hover): the one that wears the glow
	previewType: () => string | null; // a type hovered in the filter legend: dim every other type
	nodeMap: () => Map<string, FGNode>;
	currentLinks: () => FGLink[];
	enclosures: () => Map<string, FocusEnclosure>;
	graph: () => FocusGraph | undefined;
	engineFrozen: () => boolean; // at REST: pin still-free nodes before the colour re-pool tick so it cannot jump an under-converged layout
	pinNode: (n: FGNode) => void; // record the rest-time focus pin (rides the data-feed pin set; released at the next engine stop)
	worldPerPxAt: (pos: { x?: number; y?: number; z?: number }) => number | null; // the zoom signal readableK scales from
	focusEdgeColor: () => string; // full-contrast foreground a focused edge/label brightens to
	edgeLineColor: () => string; // resting line colour
	edgeLabelColor: () => string; // resting edge-label colour
	focusTextPx: () => number; // the on-screen target size the focus chip pops to
	glowRamp: () => readonly string[]; // the active node's glow colours, cycled per frame (theme-chosen)
	// Per-kind opacity for each focus tier (see focus-policy). Injected so the enclosure/line/label tier values stay
	// the component's single source (they reference the enclosure resting opacities the component also paints with).
	nodeTiers: KindTiers;
	lineTiers: KindTiers;
	edgeLabelTiers: KindTiers;
	enclosureFillTiers: KindTiers;
	enclosureEdgeTiers: KindTiers;
	enclosureLabelTiers: KindTiers;
};

export class PolymorphicFocus {
	private lastMagnifiedFocus: string | null = null; // the node whose chip last popped: a re-assert with the same focus must not re-fire the attention pop
	private magnifyAnims = new Map<FGNode, { from: number; to: number; start: number; pulse?: boolean }>();
	private freshGlows = new Map<FGNode, number>(); // freshly-streamed node → when it arrived; it wears the glow until NEWCOMER_GLOW_MS
	private heldGlows: Set<FGNode> | undefined; // the glows drawn once and held while the breath rests; undefined while it breathes

	constructor(private deps: FocusDeps) {}

	/** Register the arrival of a freshly-streamed node: the cartoon grow-in (the DataPipeline seeds it; the magnify owns
	 *  the easing) and the glow it wears for its first moments, so the eye finds where the new record landed. */
	seedNewcomerPop(n: FGNode): void {
		this.magnifyAnims.set(n, { from: 0.25, to: 1, start: performance.now() });
		this.freshGlows.set(n, performance.now());
	}

	/** A link's focus state: incident edges go full, everything else dims; preview overrides (see focus-policy.ts). */
	private linkFocusState(l: FGLink): FocusState {
		const focus = this.deps.focusId();
		const preview = this.deps.previewType();
		const nodeMap = this.deps.nodeMap();
		const s = linkEndId(l.source);
		const t = linkEndId(l.target);
		const incident = focus !== null && (s === focus || t === focus);
		const matchesPreview = preview !== null && nodeMap.get(s)?.type === preview && nodeMap.get(t)?.type === preview;
		return focusStateFor({ focusActive: focus !== null, isInFocus: incident, previewActive: preview !== null, matchesPreview });
	}

	/** The rgba a line carries: colour is full-contrast when focused, resting otherwise; the alpha IS the line's
	 *  opacity (the lib multiplies it by the global linkOpacity of 1). This is the whole line dim/highlight mechanism. */
	lineRgbaFor(l: FGLink): string {
		const state = this.linkFocusState(l);
		const rgb = rgbTriplet(isFullContrast(state) ? this.deps.focusEdgeColor() : this.deps.edgeLineColor());
		return `rgba(${rgb},${opacityFor(state, this.deps.lineTiers)})`;
	}

	/**
	 * Dim every node/edge/label except the focus node and its immediate neighbours, which stay lit. Sizing is scoped
	 * tightly: ONLY the focus node's chip pops, to a readable on-screen size, with an attention-getting overshoot:
	 * while neighbour chips and every edge label keep their natural size. So pointing at a hub dims the rest but never
	 * rescales the neighbourhood. With no focus, everything returns to full opacity and unit scale.
	 */
	applyFocus(): void {
		const focus = this.deps.focusId();
		const nodeMap = this.deps.nodeMap();
		const previewType = this.deps.previewType();
		// A purely-visual focus must NOT move the layout. Re-pooling linkColor (below) makes the lib tick the sim once,
		// and a force layout that froze before full convergence (a big graph capped by the warmup budget, so it happens
		// only ~half the time, when the random layout didn't settle in budget) JUMPS on that one tick: "the graph
		// rescales/moves on hover". So at REST, pin every still-free node where it sits first: the reheat then moves
		// the COLOUR only, never the positions. These pins ride the data-feed pin set, so the same engine-stop that ends
		// the reheat releases them (no permanent freeze); already-pinned nodes (the selection) are left as they are. Only
		// at rest, during a genuine settle the engine owns the layout (and the hover is guarded then anyway).
		if (this.deps.engineFrozen()) {
			for (const n of nodeMap.values()) {
				if (n.fx === undefined && n.x !== undefined && n.y !== undefined) {
					n.fx = n.x;
					n.fy = n.y;
					this.deps.pinNode(n);
				}
			}
		}
		// Lines: re-assert the colour accessor so the lib re-pools every edge to its focus-state rgba. The lib owns
		// line opacity (global × colour alpha); there is no mesh to write and nothing to retry. The direction arrows
		// ride the same rgba so they dim/brighten with their edge.
		const graph = this.deps.graph();
		graph?.linkColor((l) => this.lineRgbaFor(l));
		graph?.linkDirectionalArrowColor((l) => this.lineRgbaFor(l));
		// One pass over links for the consumer-owned label sprites + to collect the focus neighbourhood for the nodes.
		const neighbors: Set<string> | null = focus ? new Set([focus]) : null;
		for (const l of this.deps.currentLinks()) {
			const s = linkEndId(l.source);
			const t = linkEndId(l.target);
			if (focus !== null && (s === focus || t === focus) && neighbors) {
				neighbors.add(s);
				neighbors.add(t);
			}
			const state = this.linkFocusState(l);
			const label = l.__labelSprite;
			if (label) {
				setOpacityDeep(label, opacityFor(state, this.deps.edgeLabelTiers));
				const wantColor = isFullContrast(state) ? this.deps.focusEdgeColor() : this.deps.edgeLabelColor();
				if (label.color !== wantColor) label.color = wantColor; // guarded: the colour setter re-rasters the texture
			}
		}
		const freshFocus = focus !== this.lastMagnifiedFocus; // a NEW focus fires the attention pop; a re-assert (theme/camera, same focus) does not
		this.lastMagnifiedFocus = focus;
		const selected = this.deps.selectedId(); // hoisted: it cannot change during the pass, and reading it costs a map lookup
		for (const n of nodeMap.values()) {
			const inFocus = focus !== null && (neighbors?.has(n.id) ?? false);
			const state = focusStateFor({ focusActive: focus !== null, isInFocus: inFocus, previewActive: previewType !== null, matchesPreview: n.type === previewType });
			if (n.__visual) n.__visual.opacity = opacityFor(state, this.deps.nodeTiers); // the visual owns how its concrete object dims (a chip's text fill, a sprite's material)
			n.__visual?.setHighlighted(n.id === selected || this.freshGlows.has(n)); // the glow: the ACTIVE node wears it always, a newcomer for its first moments
			const isFocus = n.id === focus;
			this.aimMagnify(n, isFocus, isFocus && freshFocus);
		}
		this.applyEnclosureFocus();
	}

	/** Group enclosures follow the node dimming: only the previewed type's (or the focused node's) group stays lit. */
	applyEnclosureFocus(): void {
		const enclosures = this.deps.enclosures();
		if (enclosures.size === 0) return;
		const focus = this.deps.focusId();
		const focusType = focus ? (this.deps.nodeMap().get(focus)?.type ?? null) : null;
		const preview = this.deps.previewType();
		for (const [key, e] of enclosures) {
			const state = focusStateFor({ focusActive: focusType !== null, isInFocus: key === focusType, previewActive: preview !== null, matchesPreview: key === preview });
			setOpacityDeep(e.label, opacityFor(state, this.deps.enclosureLabelTiers));
			e.boxMat.opacity = opacityFor(state, this.deps.enclosureFillTiers);
			e.edgeMat.opacity = opacityFor(state, this.deps.enclosureEdgeTiers);
		}
	}

	/** Only the focus node's chip pops, to a readable on-screen size (readableK never shrinks, so an already-readable
	 *  chip stays put) with the attention overshoot in setMagnifyTarget; every other node resolves to natural size. */
	private aimMagnify(n: FGNode, isFocus: boolean, freshlyFocused = false): void {
		const to = isFocus ? this.readableK(n, chipTextHeight(n), this.deps.focusTextPx()) : 1;
		this.setMagnifyTarget(n, to, isFocus, freshlyFocused);
	}

	/** The multiplier that renders text of `baseTextHeight` world units at targetPx on screen, from the camera
	 * distance at `pos` (via the camera's worldPerPxAt). Never below natural size, so an already-readable chip stays put. */
	private readableK(pos: { x?: number; y?: number; z?: number }, baseTextHeight: number, targetPx: number): number {
		const worldPerPx = this.deps.worldPerPxAt(pos);
		if (worldPerPx === null) return 1; // camera not ready: no pop (never a blind enlargement)
		return Math.min(Math.max((targetPx * worldPerPx) / baseTextHeight, 1), MAX_MAGNIFY);
	}

	/** Re-aim the focus chip as the camera moves, so "readable" holds while zooming. Sampled from the rAF tick. */
	retargetMagnify(): void {
		const focus = this.deps.focusId();
		if (!focus) return;
		const n = this.deps.nodeMap().get(focus);
		if (n) this.aimMagnify(n, true);
	}

	/** Aim a node's magnify multiplier; the rAF tick animates toward it. The raster follows the scale so magnified text stays crisp. */
	private setMagnifyTarget(n: FGNode, to: number, focused: boolean, freshlyFocused = false): void {
		const sprite = n.__sprite;
		if (!sprite || !n.__baseScale) return;
		const wantFont = Math.round(Math.min(MAX_FONT_SIZE, NODE_FONT_SIZE * Math.max(1, to)));
		if (Math.abs(sprite.fontSize - wantFont) > 16) sprite.fontSize = wantFont; // setter regenerates the texture; tolerance avoids regen churn while zooming
		sprite.renderOrder = focused ? FOCUS_RENDER_ORDER : NODE_RENDER_ORDER;
		const current = n.__k ?? 1;
		const pending = this.magnifyAnims.get(n);
		if (Math.abs((pending?.to ?? current) - to) < 0.05) {
			// Already at readable size: acknowledge focus with a pop up-and-back instead of a resize.
			if (freshlyFocused) this.magnifyAnims.set(n, { from: current, to: current, start: performance.now(), pulse: true });
			return;
		}
		this.magnifyAnims.set(n, { from: current, to, start: performance.now() });
	}

	/** Breathe every worn glow each beat: the active node's for as long as it is active, each newcomer's until its
	 *  first moments end, one rhythm, one colour, one write per glowing node. Returns whether a frame is needed, so the
	 *  render loop draws it (a paused scene would freeze the breath mid-cycle, and an expiry nobody draws never
	 *  ends). With `pulsing` false the breath rests: each glow is drawn once at its fullest and held, and a frame is
	 *  needed only on the beat the set of worn glows changes. The scene's regulator selects which, from what a frame costs. */
	updateHighlight(pulsing = true): boolean {
		const now = performance.now();
		const id = this.deps.selectedId();
		const glowing = new Set<FGNode>();
		let ended = false;
		for (const [n, born] of this.freshGlows) {
			if (now - born > NEWCOMER_GLOW_MS) {
				this.freshGlows.delete(n);
				if (n.id !== id) {
					n.__visual?.setHighlighted(false); // the glow ends with the welcome, unless the reader made it the active node
					ended = true;
				}
				continue;
			}
			if (n.__visual) glowing.add(n);
		}
		const selected = id ? this.deps.nodeMap().get(id) : undefined;
		if (selected?.__visual?.hasHighlight) glowing.add(selected);
		if (pulsing) {
			this.heldGlows = undefined;
			if (glowing.size === 0) return ended;
			const intensity = pulseAt(now);
			const color = glowColorAt(intensity, this.deps.glowRamp());
			for (const n of glowing) n.__visual?.setHighlighted(true, { intensity, color });
			return true;
		}
		const held = this.heldGlows;
		if (held && held.size === glowing.size && [...glowing].every((n) => held.has(n))) return ended;
		this.heldGlows = glowing;
		const color = glowColorAt(RESTING_INTENSITY, this.deps.glowRamp());
		for (const n of glowing) n.__visual?.setHighlighted(true, { intensity: RESTING_INTENSITY, color });
		return true;
	}

	/** Animate magnify multipliers each frame: easeOutBack overshoots past the target and settles: the cartoon pop. */
	updateMagnify(): void {
		if (this.magnifyAnims.size === 0) return;
		const now = performance.now();
		for (const [n, a] of this.magnifyAnims) {
			const sprite = n.__sprite;
			const base = n.__baseScale;
			if (!sprite || !base) {
				// A grow-in is seeded before the lib builds the sprite, wait briefly; drop only if it never appears.
				if (now - a.start > 2000) this.magnifyAnims.delete(n);
				continue;
			}
			const t = Math.min((now - a.start) / MAGNIFY_MS, 1);
			let k = a.from + (a.to - a.from) * easeOutBack(t);
			if (a.pulse) k += PULSE_AMP * Math.sin(Math.PI * t); // up and back, acknowledgement without a resize
			n.__k = k;
			sprite.scale.set(base.x * k, base.y * k, 1);
			if (t >= 1) {
				n.__k = a.to;
				this.magnifyAnims.delete(n);
			}
		}
	}
}
