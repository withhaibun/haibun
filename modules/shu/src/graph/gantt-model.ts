/**
 * Project quads into the renderer-agnostic Gantt model. A node is a task when it carries a `ganttStart` property; its
 * fields are recognised by their declared upper concept (isSubPropertyOf), so ANY concrete vocabulary that sits under
 * `ganttStart`/`ganttEnd`/`ganttDuration`/`ganttEffort`/`ganttDepends` is picked up — not a fixed predicate list.
 */
import { LinkRelations, isSubPropertyOf } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import type { TGanttModel, TGanttTask } from "./gantt-renderer.js";

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
		let start: number | undefined;
		let end: number | undefined;
		let duration: number | undefined;
		let effort: number | undefined;
		const dependsOn: string[] = [];
		for (const q of sq) {
			const rel = relOf(q.predicate, q.namedGraph);
			if (isSubPropertyOf(rel, G_START)) start = parseTime(q.object);
			else if (isSubPropertyOf(rel, G_END)) end = parseTime(q.object);
			else if (isSubPropertyOf(rel, G_DURATION)) duration = parseNum(q.object);
			else if (isSubPropertyOf(rel, G_EFFORT)) effort = parseNum(q.object);
			else if (isSubPropertyOf(rel, G_DEPENDS) && typeof q.object === "string") dependsOn.push(q.object);
		}
		if (start === undefined || Number.isNaN(start)) continue;
		if (end === undefined && duration !== undefined) end = start + duration;
		if (end === undefined || Number.isNaN(end)) continue;
		tasks.push({ id: subject, label: opts.displayLabel?.(sq[0].namedGraph, subject) ?? subject, start, end, effort, dependsOn: dependsOn.length > 0 ? dependsOn : undefined });
	}
	tasks.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
	return { tasks };
}

/** True when any subject carries a `ganttStart`-kind property — the cue an ontology paint-picker uses to choose the Gantt view. */
export function isGanttable(quads: TQuad[], relOf: RelOf = identityRel): boolean {
	return quads.some((q) => isSubPropertyOf(relOf(q.predicate, q.namedGraph), G_START));
}
