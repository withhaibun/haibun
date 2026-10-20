/**
 * The lines of a graph's source as the source pane reads them, and the selection that links them to the scene both ways: the
 * line a key moves to, the statement and record behind a line, the summary of the source's kinds, the lines that state the
 * nodes and edges a reader chose in the scene, and the nodes and edges the scene draws that a line states. A scene names the
 * projection's terms through its naming: the terms of a source as the projection names them, and a graph of records by each
 * record's and each predicate's id, whose text the projection's constant or predicate names.
 */
import { edgeKey, formulasStating, statedBy } from "@haibun/logic/derivations/term-graph.js";
import type { TProjection } from "@haibun/logic/domains/logic.js";

type TFormulaLine = TProjection["formulas"][number];

/** An edge the scene draws: its ends and its predicate, by the scene's ids. */
export type TDrawnEdge = { from: string; predicate: string; to: string };

/** What a scene draws, by its ids. */
export type TDrawn = { nodes: readonly string[]; edges: readonly TDrawnEdge[] };

/** The nodes and the edge keys a selection names, by the scene's ids. */
export type TSceneSelection = { nodes: string[]; edges: string[] };

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

/** The statement behind a line, and the record that asserted it where a record did, as a hover shows them. */
export const provenanceOf = ({ statement, assertedBy }: TFormulaLine): string =>
	assertedBy === undefined ? statement : `${statement} · asserted by ${assertedBy.persistedAs} ${assertedBy.id}`;

/** The source's kinds, each with its count. */
export const summaryOf = (summary: TProjection["summary"]): string =>
	Object.entries(summary)
		.map(([kind, count]) => `${kind} ${count}`)
		.join(" · ");

/** A count of a noun, which takes an s for any count but one. */
const counted = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** What the lines state to a reader who isn't looking at the scene: what the reader's line lights there, or how many lines
 *  the reader's choice in the scene lights. */
export function statusOf(line: string | null, lights: TSceneSelection | null, lit: ReadonlySet<string>): string {
	if (line !== null && lights !== null) return `${line} lights ${counted(lights.nodes.length, "node")} and ${counted(lights.edges.length, "edge")}`;
	return lit.size > 0 ? `the selection lights ${counted(lit.size, "line")}` : "";
}

/** The key of a drawn edge as the projection names it, through the scene's naming. */
const namedKey = (naming: (id: string) => string, { from, predicate, to }: TDrawnEdge): string => edgeKey(naming(from), naming(predicate), naming(to));

/** The lines that state the nodes and edges a reader chose in the scene. */
export const linesOfScene = (projection: TProjection, naming: (id: string) => string, chosen: { nodes: readonly string[]; edges: readonly TDrawnEdge[] }): string[] =>
	formulasStating(projection, new Set(chosen.nodes.map(naming)), new Set(chosen.edges.map((edge) => namedKey(naming, edge))));

/** The nodes and edges the scene draws that a line states, by the scene's ids and its edges' keys. */
export function sceneOfLine(projection: TProjection, naming: (id: string) => string, line: string, drawn: TDrawn): TSceneSelection {
	const stated = statedBy(projection, line);
	const [nodes, edges] = [new Set(stated.nodes), new Set(stated.edges)];
	return {
		nodes: drawn.nodes.filter((id) => nodes.has(naming(id))),
		edges: drawn.edges.filter((edge) => edges.has(namedKey(naming, edge))).map(({ from, predicate, to }) => edgeKey(from, predicate, to)),
	};
}
