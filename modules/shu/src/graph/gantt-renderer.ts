/**
 * SVG Gantt paint: one row per task, bars placed on a linear calendar (time) axis, with dependency arrows between bars.
 * Renderer-agnostic of any quad/rel shape — a consumer maps its data to `{ tasks }`. Pure markup (no DOM), so the same
 * paint runs in a browser component and in a Node report bake, like the graph + sequence paints.
 *
 * `start`/`end` are epoch milliseconds. `effort` (optional) is work amount in the same unit as the elapsed span — drawn
 * as a darker inner bar (effort ≤ elapsed) so "work vs elapsed time" reads at a glance. `dependsOn` lists task ids this
 * task waits on; each is drawn as an arrow from the dependency's bar end to this task's bar start.
 */
import { xml, truncate, arrowMarker, ARROW_MARKER_ID, SVG_MARGIN as MARGIN } from "./svg-util.js";

export type TGanttTask = { id: string; label: string; start: number; end: number; effort?: number; dependsOn?: string[] };
export type TGanttModel = { tasks: TGanttTask[] };

const LABEL_W = 160; // left column holding task labels
const ROW_H = 26;
const BAR_H = 14;
const HEADER_H = 26; // top band for the calendar axis
const CHART_W = 640; // time-axis width
const TICKS = 5;
const BAR_FILL = "#2848a8";
const EFFORT_FILL = "#16245c";
const GRID = "var(--shu-border)";

const fmtDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Pure SVG markup for a Gantt chart (no DOM). Tasks with a non-finite start/end are skipped. */
export function ganttToSvg(model: TGanttModel): string {
	const tasks = model.tasks.filter((t) => Number.isFinite(t.start) && Number.isFinite(t.end) && t.end >= t.start);
	const chartX = MARGIN + LABEL_W;
	const width = chartX + CHART_W + MARGIN;
	const height = HEADER_H + MARGIN + Math.max(1, tasks.length) * ROW_H + MARGIN;
	if (tasks.length === 0) {
		return `<svg class="shu-gantt-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><text x="${MARGIN}" y="${HEADER_H + MARGIN}" font-size="12" fill="var(--shu-fg-faded)">No scheduled tasks</text></svg>`;
	}
	const min = Math.min(...tasks.map((t) => t.start));
	const max = Math.max(...tasks.map((t) => t.end));
	const span = Math.max(max - min, 1);
	const timeX = (t: number): number => chartX + ((t - min) / span) * CHART_W;
	const rowY = (i: number): number => HEADER_H + MARGIN + i * ROW_H;
	const rowOf = new Map(tasks.map((t, i) => [t.id, i]));

	// Calendar axis: evenly spaced date gridlines spanning [min, max].
	const axisBottom = height - MARGIN;
	let axis = "";
	for (let k = 0; k <= TICKS; k++) {
		const t = min + (span * k) / TICKS;
		const x = timeX(t);
		axis += `<line class="gantt-grid" x1="${x.toFixed(1)}" y1="${HEADER_H}" x2="${x.toFixed(1)}" y2="${axisBottom.toFixed(1)}" stroke="${GRID}" stroke-dasharray="2 3"/><text class="gantt-tick" x="${x.toFixed(1)}" y="${(HEADER_H - 8).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--shu-fg-muted)">${fmtDate(t)}</text>`;
	}

	const rows = tasks
		.map((t, i) => {
			const y = rowY(i);
			const x1 = timeX(t.start);
			const x2 = timeX(t.end);
			const w = Math.max(x2 - x1, 2);
			const elapsed = t.end - t.start;
			const effortW = t.effort !== undefined && elapsed > 0 ? (Math.min(t.effort, elapsed) / elapsed) * w : 0;
			const label = `<text class="gantt-label" x="${MARGIN}" y="${(y + BAR_H / 2 + 4).toFixed(1)}" font-size="11" fill="var(--shu-fg)">${xml(truncate(t.label, 22))}</text>`;
			const bar = `<rect class="gantt-bar" x="${x1.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${BAR_H}" rx="3" fill="${BAR_FILL}"/>`;
			const effort = effortW > 0 ? `<rect class="gantt-effort" x="${x1.toFixed(1)}" y="${y.toFixed(1)}" width="${effortW.toFixed(1)}" height="${BAR_H}" rx="3" fill="${EFFORT_FILL}"/>` : "";
			return `<g class="gantt-task" data-task-id="${xml(t.id)}">${label}${bar}${effort}</g>`;
		})
		.join("");

	// Dependency arrows: from the dependency's bar end to this task's bar start (only when both are placed tasks).
	const deps = tasks
		.flatMap((t) =>
			(t.dependsOn ?? []).map((depId) => {
				const di = rowOf.get(depId);
				const ti = rowOf.get(t.id);
				if (di === undefined || ti === undefined) return "";
				const dep = tasks[di];
				const fromX = timeX(dep.end);
				const fromY = rowY(di) + BAR_H / 2;
				const toX = timeX(t.start);
				const toY = rowY(ti) + BAR_H / 2;
				return `<path class="gantt-dep" data-from="${xml(depId)}" data-to="${xml(t.id)}" d="M${fromX.toFixed(1)},${fromY.toFixed(1)} L${toX.toFixed(1)},${toY.toFixed(1)}" fill="none" stroke="var(--shu-fg-faded)" stroke-width="1.5" marker-end="url(#${ARROW_MARKER_ID})"/>`;
			}),
		)
		.join("");

	return `<svg class="shu-gantt-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><defs>${arrowMarker()}</defs><g class="gantt-axis">${axis}</g><g class="gantt-deps">${deps}</g><g class="gantt-tasks">${rows}</g></svg>`;
}

/** Canonical text for a Gantt (skip-when-unchanged key + copy artifact). */
export function ganttToText(model: TGanttModel): string {
	const lines = ["gantt"];
	for (const t of model.tasks) {
		const dur = `${fmtDate(t.start)}..${fmtDate(t.end)}`;
		const effort = t.effort !== undefined ? ` effort=${t.effort}` : "";
		const deps = t.dependsOn?.length ? ` after ${t.dependsOn.join(", ")}` : "";
		lines.push(`  ${t.id}: ${t.label} [${dur}]${effort}${deps}`);
	}
	return lines.join("\n");
}
