/**
 * The backend-neutral LAYOUT pass: resolve marks' declared LayoutRoles into placements (where each node sits) + any
 * axis adornment, sharing one scale across all nodes of a role. Pure — same marks in, same scene out — so the 3D
 * and SVG paints place marks identically and can't drift. Position + size live HERE (in the placement), not on the
 * mark: the presenter declares a node's role (e.g. its time span); this pass turns the whole set into coordinates.
 *
 * - `free`  → no placement: the force layout owns x/y, z is the recorded-time depth (the view's default).
 * - `time`  → one shared calendar scale across every time-role node → a lane y, a z centre, a duration zExtent, plus a
 *             ruler adornment. (Reproduces the gantt layout, now driven by the marks rather than a private path.)
 * - `xyz`   → explicit coordinates, pinned as given.
 * - `geo`   → a naive equirectangular placement (lon→x, lat→y); a real map paint can refine the projection later.
 */
import type { LayoutRole } from "./graph-scene.js";
import { timeToGanttX, ganttAxisTicks, type GanttTick } from "./gantt-layout.js";
import { GANTT_ROW_H, GANTT_WORLD_W } from "./gantt-layout.js";

/** The slice of a node the layout needs — its identity + declared role. A NodeMark satisfies this. */
export type LayoutItem = { id: string; role: LayoutRole };

/** Where a node is placed. Undefined dims fall back to the view's default (force x/y, recorded-time z). `zExtent` is the
 *  mark's length along z (a calendar bar's duration in world units), consumed only by length-bearing marks (box). */
export type Placement = { x?: number; y?: number; z?: number; zExtent?: number };
/** A backend-neutral view adornment (drawn once per layout, not per node). The calendar ruler: a baseline along z with
 *  calendar tick marks, just below the lowest lane. Null when the layout has no axis to draw. */
export type Adornment = { kind: "calendar-axis"; baseY: number; zMin: number; zMax: number; ticks: GanttTick[] } | null;
export type LayoutResult = { placements: Map<string, Placement>; scale?: { min: number; span: number }; adornment: Adornment };

const GEO_DEG_TO_WORLD = 2; // naive equirectangular scale until a real map projection lands

type TimeItem = { id: string; role: { kind: "time"; start: number; end: number } };

export function computeLayout(items: ReadonlyArray<LayoutItem>): LayoutResult {
	const placements = new Map<string, Placement>();
	for (const m of items) {
		if (m.role.kind === "xyz") placements.set(m.id, { x: m.role.x, y: m.role.y, z: m.role.z });
		else if (m.role.kind === "geo") placements.set(m.id, { x: m.role.lon * GEO_DEG_TO_WORLD, y: m.role.lat * GEO_DEG_TO_WORLD });
	}
	// Calendar: one scale across all time-role items, ordered by start then id → one lane each (matching the gantt model).
	const timed = items.filter((m): m is TimeItem => m.role.kind === "time").sort((a, b) => a.role.start - b.role.start || a.id.localeCompare(b.id));
	if (timed.length === 0) return { placements, adornment: null };
	const min = Math.min(...timed.map((m) => m.role.start));
	const max = Math.max(...timed.map((m) => m.role.end));
	const span = Math.max(max - min, 1);
	const scale = { min, span };
	const top = ((timed.length - 1) * GANTT_ROW_H) / 2;
	timed.forEach((m, i) => {
		placements.set(m.id, {
			x: 0,
			y: top - i * GANTT_ROW_H,
			z: timeToGanttX((m.role.start + m.role.end) / 2, scale),
			zExtent: ((m.role.end - m.role.start) / span) * GANTT_WORLD_W,
		});
	});
	const baseY = top - (timed.length - 1) * GANTT_ROW_H - GANTT_ROW_H; // just below the lowest lane
	return { placements, scale, adornment: { kind: "calendar-axis", baseY, zMin: timeToGanttX(min, scale), zMax: timeToGanttX(max, scale), ticks: ganttAxisTicks(scale) } };
}
