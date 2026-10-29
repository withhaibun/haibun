/**
 * The lines of a graph's axioms as the axioms pane reads them: the line a key moves to, the statement and record behind a
 * line, the summary of the source's kinds, what the pane states of the reader's line, and the lines that state the reader's
 * active records. A line is a frame of the graph's axioms, which names the records and edges it states by the scene's ids.
 */
import type { TGraphAxioms, TFrame } from "@haibun/core/lib/records/domains/axioms.js";

/** An edge the scene draws: its ends and its predicate, by the scene's ids. */
export type TDrawnEdge = { from: string; predicate: string; to: string };

/** What a scene draws, by its ids. */
export type TDrawn = { nodes: readonly string[]; edges: readonly TDrawnEdge[] };

/** The keys that move a reader through the lines: a step down or up, or to the first or the last. */
const STEPS: Readonly<Record<string, (at: number, last: number) => number>> = {
	ArrowDown: (at, last) => Math.min(at + 1, last),
	ArrowUp: (at) => Math.max(at - 1, 0),
	Home: () => 0,
	End: (_at, last) => last,
};

/** The line `key` moves a reader on `current` to, the first line where the reader isn't on one; undefined for a key that
 *  doesn't move a reader, or lines that don't hold one. */
export function lineAfterKey(names: readonly string[], current: string | null, key: string): string | undefined {
	const step = STEPS[key];
	if (step === undefined || names.length === 0) return undefined;
	const at = current === null ? -1 : names.indexOf(current);
	return names[at < 0 ? 0 : step(at, names.length - 1)];
}

/** A line's axioms in DL notation, the statement behind it, and the record that asserted it where a record did, as a hover shows them. */
export const provenanceOf = ({ dl, statement, assertedBy }: TFrame): string =>
	[dl, statement, ...(assertedBy === undefined ? [] : [`asserted by ${assertedBy.persistedAs} ${assertedBy.id}`])].join(" · ");

/** The source's kinds, each with its count. */
export const summaryOf = (summary: TGraphAxioms["summary"]): string =>
	Object.entries(summary)
		.map(([kind, count]) => `${kind} ${count}`)
		.join(" · ");

/** What the pane states of the reader's line: its axioms, its statement and its record; else how many lines state the
 *  reader's active record. */
export function statusOf(line: TFrame | undefined, lit: ReadonlySet<string>): string {
	if (line !== undefined) return provenanceOf(line);
	return lit.size === 0 ? "" : `the selection lights ${lit.size} ${lit.size === 1 ? "line" : "lines"}`;
}

/** The lines that state the records `nodes` names. */
export const linesOf = ({ frames }: TGraphAxioms, nodes: readonly string[]): string[] =>
	frames.filter((frame) => frame.nodes.some((id) => nodes.includes(id))).map(({ name }) => name);
