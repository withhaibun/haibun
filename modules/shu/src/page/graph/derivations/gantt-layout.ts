/**
 * Gantt calendar-axis mapping: time ⇄ world-x, in one place so the forward placement (recomputeGanttTargets) and the
 * inverse a drag relies on (a dropped bar's new x → its rescheduled time) can't drift. Pure arithmetic, unit-tested
 * without a scene.
 */
import type { GanttExtent } from "../machines/camera.js";

// Gantt sizing/layout constants (the gantt module owns them; the 3D paint + view import these from here).
export const GANTT_WORLD_W = 220; // world-units the calendar time axis spans
export const GANTT_ROW_H = 14; // world-units between task rows
export const GANTT_BAR_H = 8; // duration-bar height (< GANTT_ROW_H so rows stay distinct)
export const GANTT_BAR_D = 6; // duration-bar depth: a genuine 3D box (orbits to real volume), not a flat slab
export const GANTT_MIN_BAR_W = 4; // floor so a zero/short-duration task still shows a clickable bar
export const GANTT_LABEL_INSET = 2; // nudge the label in from the bar's start edge so the text stays inside the box
export const GANTT_GHOST_PAD = 1.5; // drag-outline grows the bar dims by this so the wireframe reads around (not on) the bar

export type GanttScale = { min: number; span: number };

/** Where a task's bar is placed: y its lane, z the centre of its span on the time axis, zLen that span, and the times it covers. */
export type GanttTarget = { y: number; z: number; zLen: number; start: number; end: number };

/** A mark placed on a lane: its lane (y) and the part of the time axis (z) it spans. */
export type TLaneSpan = { y: number; zFrom: number; zTo: number };

/** The extent a camera frames over lane-placed marks: the centre of their lanes (y, screen-vertical) and of their span in
 *  time (z, screen-horizontal), and the half of each span, padded by `pad` so the outermost mark's label stays inside the
 *  frame. Null for a set without a mark. */
export function laneExtent(spans: Iterable<TLaneSpan>, pad: { lane: number; time: number }): GanttExtent | null {
	let minY = Infinity;
	let maxY = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	for (const { y, zFrom, zTo } of spans) {
		minY = Math.min(minY, y);
		maxY = Math.max(maxY, y);
		minZ = Math.min(minZ, zFrom);
		maxZ = Math.max(maxZ, zTo);
	}
	if (minY === Infinity) return null;
	return { cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2, halfH: Math.max((maxY - minY) / 2 + pad.lane, 1), halfW: Math.max((maxZ - minZ) / 2 + pad.time, 1) };
}

/** The extent of the placed gantt bars, a lane of room on the lane axis. */
export function ganttExtentOf(targets: Iterable<GanttTarget>): GanttExtent | null {
	return laneExtent(
		[...targets].map(({ y, z, zLen }) => ({ y, zFrom: z - zLen / 2, zTo: z + zLen / 2 })),
		{ lane: GANTT_ROW_H, time: 0 },
	);
}

/** A time (epoch ms) → its x on the calendar axis (origin-centred, spanning ±GANTT_WORLD_W/2). */
export const timeToGanttX = (timeMs: number, scale: GanttScale): number => ((timeMs - scale.min) / scale.span - 0.5) * GANTT_WORLD_W;

/** Inverse: a bar's centre x + its world width → the [start, end] it now covers, preserving the width as elapsed time. */
export function ganttBarSpan(centerX: number, barWidth: number, scale: GanttScale): { start: number; end: number } {
	const durMs = (barWidth / GANTT_WORLD_W) * scale.span;
	const midMs = scale.min + (centerX / GANTT_WORLD_W + 0.5) * scale.span;
	return { start: Math.round(midMs - durMs / 2), end: Math.round(midMs + durMs / 2) };
}

export type GanttTick = { ms: number; z: number; label: string };
const DAY_MS = 86400000;
const TARGET_TICKS = 8; // aim for roughly this many marks across the span

/** Calendar tick marks across the gantt time axis: a step sized to the span (so a drag has a date reference), each
 *  tick's epoch-ms, its z on the axis, and a short label. Day/week steps align to UTC midnight + label MM-DD; month/
 *  quarter/year steps walk the calendar (UTC, without drift) + label YYYY-MM. */
export function ganttAxisTicks(scale: GanttScale): GanttTick[] {
	const { min, span } = scale;
	const end = min + span;
	const ticks: GanttTick[] = [];
	const add = (ms: number, label: string): void => {
		ticks.push({ ms, z: timeToGanttX(ms, scale), label });
	};
	const dayStep = [1, 2, 7, 14].find((d) => span / (d * DAY_MS) <= TARGET_TICKS);
	if (dayStep) {
		for (let ms = Math.ceil(min / DAY_MS) * DAY_MS; ms <= end; ms += dayStep * DAY_MS) add(ms, new Date(ms).toISOString().slice(5, 10));
		return ticks;
	}
	const monthsPerStep = span / (30 * DAY_MS) <= TARGET_TICKS ? 1 : span / (91 * DAY_MS) <= TARGET_TICKS ? 3 : 12;
	const d = new Date(min);
	let cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
	if (cur < min) cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); // first whole month boundary at/after min
	while (cur <= end) {
		const c = new Date(cur);
		add(cur, c.toISOString().slice(0, 7));
		cur = Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + monthsPerStep, 1);
	}
	return ticks;
}
