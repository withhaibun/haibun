/**
 * Project quads into the renderer-agnostic Gantt model. A node is a task when it carries a `ganttStart` property; its
 * fields are recognised by their declared upper concept (isSubPropertyOf), so ANY concrete vocabulary that sits under
 * `ganttStart`/`ganttEnd`/`ganttDuration`/`ganttEffort`/`ganttDepends` is picked up — not a fixed predicate list.
 */
import { LinkRelations, isSubPropertyOf } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

/** A schedulable node: an id + label, a start/end on the calendar (epoch ms), optional effort (work, in the same unit
 *  as the elapsed span), and the ids it waits on. Consumed by the 3D gantt layout (positions + duration widths). */
export type TGanttTask = { id: string; label: string; start: number; end: number; effort?: number; dependsOn?: string[] };
export type TGanttModel = { tasks: TGanttTask[] };

const G_START = LinkRelations.GANTT_START.rel;
const G_END = LinkRelations.GANTT_END.rel;
const G_DURATION = LinkRelations.GANTT_DURATION.rel;
const G_EFFORT = LinkRelations.GANTT_EFFORT.rel;
const G_DEPENDS = LinkRelations.GANTT_DEPENDS.rel;

/** Map a quad's (predicate, graph) to its link relation. The predicate IS the rel for canonical rels; a consumer can
 *  supply a resolver (e.g. the browser classifier, which keys off the graph type) for its own predicates. */
type RelOf = (predicate: string, graph: string) => string;
const identityRel: RelOf = (p) => p;

const parseTime = (v: unknown): number => {
	const ms = Date.parse(String(v));
	return Number.isNaN(ms) ? Number(v) : ms;
};
const parseNum = (v: unknown): number | undefined => {
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
};

export type GanttModelOpts = { displayLabel?: (graph: string, subject: string) => string | undefined; relOf?: RelOf };

/** Build the Gantt model from quads. Subjects without a `ganttStart` (and an end or duration) are not tasks. */
export function quadsToGanttModel(quads: TQuad[], opts: GanttModelOpts = {}): TGanttModel {
	const relOf = opts.relOf ?? identityRel;
	const bySubject = new Map<string, TQuad[]>();
	for (const q of quads) {
		const list = bySubject.get(q.subject);
		if (list) list.push(q);
		else bySubject.set(q.subject, [q]);
	}
	const tasks: TGanttTask[] = [];
	for (const [subject, sq] of bySubject) {
		const starts: number[] = [];
		const ends: number[] = [];
		let duration: number | undefined;
		let effort: number | undefined;
		const dependsOn: string[] = [];
		for (const q of sq) {
			const rel = relOf(q.predicate, q.namedGraph);
			if (isSubPropertyOf(rel, G_START)) starts.push(parseTime(q.object));
			else if (isSubPropertyOf(rel, G_END)) ends.push(parseTime(q.object));
			else if (isSubPropertyOf(rel, G_DURATION)) duration = parseNum(q.object);
			else if (isSubPropertyOf(rel, G_EFFORT)) effort = parseNum(q.object);
			else if (isSubPropertyOf(rel, G_DEPENDS) && typeof q.object === "string") dependsOn.push(q.object);
		}
		// A subject can carry several start-kind times (an activity's startedAtTime plus its record's generatedAtTime);
		// min/max keeps the true interval regardless of quad order.
		const start = Math.min(...starts.filter((t) => !Number.isNaN(t)));
		if (!Number.isFinite(start)) continue;
		const endCandidates = ends.filter((t) => !Number.isNaN(t));
		// No end-kind time and no duration: the subject is a dated instant (a milestone note, a generated record) —
		// a zero-length task placed at its moment, so every dated record shows in the calendar, point or bar.
		const end = endCandidates.length > 0 ? Math.max(...endCandidates) : duration !== undefined ? start + duration : start;
		tasks.push({ id: subject, label: opts.displayLabel?.(sq[0].namedGraph, subject) ?? subject, start, end, effort, dependsOn: dependsOn.length > 0 ? dependsOn : undefined });
	}
	tasks.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
	return { tasks };
}

/** True when any subject carries a `ganttStart`-kind property — the cue an ontology paint-picker uses to choose the Gantt view. */
export function isGanttable(quads: TQuad[], relOf: RelOf = identityRel): boolean {
	return quads.some((q) => isSubPropertyOf(relOf(q.predicate, q.namedGraph), G_START));
}

/** Rigid dependency shift for a dragged task: moving `draggedId` by `deltaMs` moves it and every task that transitively
 *  depends on it by the same delta — a dependent can't precede the task it waits on, so the whole downstream chain slides
 *  with it. Returns each affected task's new {start, end}; tasks not downstream of the drag are absent (unchanged). */
export function cascadeReschedule(draggedId: string, deltaMs: number, tasks: TGanttTask[]): Map<string, { start: number; end: number }> {
	const byId = new Map(tasks.map((t) => [t.id, t]));
	const dependents = new Map<string, string[]>(); // id → tasks that declare dependsOn it
	for (const t of tasks) {
		for (const dep of t.dependsOn ?? []) {
			const list = dependents.get(dep);
			if (list) list.push(t.id);
			else dependents.set(dep, [t.id]);
		}
	}
	const shifted = new Map<string, { start: number; end: number }>();
	const queue = [draggedId];
	while (queue.length > 0) {
		const id = queue.shift() as string;
		if (shifted.has(id)) continue;
		const t = byId.get(id);
		if (!t) continue;
		shifted.set(id, { start: t.start + deltaMs, end: t.end + deltaMs });
		for (const d of dependents.get(id) ?? []) queue.push(d);
	}
	return shifted;
}
