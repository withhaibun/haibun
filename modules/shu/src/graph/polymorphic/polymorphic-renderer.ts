// How a graph is shown, as an interface. The scene computes the placed nodes and links; a renderer displays them.
// There is no second model: a renderer is handed what the pipeline already produced, and what it displayed is read back
// through the scene's own snapshot (inspect).

import type { FGLink, FGNode } from "./polymorphic-graph-types.js";

/** What the scene displays each repaint: the pipeline's own output. */
export type TDrawn = { nodes: FGNode[]; links: FGLink[] };

/**
 * What a medium must do to show a graph. Every repaint calls `draw`, so a renderer that records what it was given uses
 * the same path as one that displays it.
 */
export interface IGraphRenderer {
	size(width: number, height: number): void;
	draw(drawn: TDrawn): void;
	/** The node shapes changed kind (a chip became a bar), not just their places. */
	rebuildNodes(): void;
}

/** Where each node was placed, by node id: what "it did not redraw" compares. */
export type TPlacement = Map<string, string>;

const placementOf = (nodes: FGNode[]): TPlacement => new Map(nodes.map((n) => [n.id, `${Math.round(n.x ?? 0)},${Math.round(n.y ?? 0)},${Math.round(n.z ?? 0)}`]));

/** Whether two displays placed the same nodes at the same positions. */
export function samePlacement(a: TPlacement | undefined, b: TPlacement | undefined): boolean {
	if (!a || !b || a.size !== b.size) return false;
	for (const [id, at] of a) if (b.get(id) !== at) return false;
	return true;
}

/** One sentence describing a drawn graph, with per-type counts: the shared text the SVG still's `<desc>` and the
 *  accessible document's status line both use, so every medium describes the graph in the same words. */
export function graphSummary({ nodes, links }: TDrawn): string {
	const counts = new Map<string, number>();
	for (const n of nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
	const types = [...counts]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([t, c]) => `${c} ${t}`)
		.join(", ");
	return `${nodes.length} nodes${types ? ` (${types})` : ""} and ${links.length} links`;
}

/** One renderer driving several media: the scene draws once and every medium shows it (WebGL and the accessible
 *  document). Each call forwards to every medium in order. */
export function compositeRenderer(...media: IGraphRenderer[]): IGraphRenderer {
	return {
		size(width: number, height: number): void {
			for (const m of media) m.size(width, height);
		},
		draw(drawn: TDrawn): void {
			for (const m of media) m.draw(drawn);
		},
		rebuildNodes(): void {
			for (const m of media) m.rebuildNodes();
		},
	};
}

/**
 * A renderer that keeps what it was given, so a test can ask what a change displayed, did a view change place the nodes
 * differently, did a merge that changed nothing display at all, without a browser.
 */
export class RecordingRenderer implements IGraphRenderer {
	readonly placements: TPlacement[] = [];
	readonly linkCounts: number[] = [];
	/** How many displays had happened at each shape rebuild, so a rebuild has its place in the order. */
	readonly rebuilds: number[] = [];
	sized?: { width: number; height: number };

	size(width: number, height: number): void {
		this.sized = { width, height };
	}

	draw({ nodes, links }: TDrawn): void {
		this.placements.push(placementOf(nodes));
		this.linkCounts.push(links.length);
	}

	rebuildNodes(): void {
		this.rebuilds.push(this.placements.length);
	}

	get last(): TPlacement | undefined {
		return this.placements.at(-1);
	}
}

/** The part of the graph library a renderer uses: the feed, the size, and the node-object factory it caches by
 *  reference. A subset of FGInstance rather than that whole interface, so the renderer depends only on what it calls. */
type TGraphLib = {
	graphData(data: TDrawn): unknown;
	width(w: number): { height(h: number): unknown };
	nodeThreeObject(fn: (n: FGNode) => unknown): unknown;
};

/**
 * The library-backed renderer: the graph is shown in WebGL. The library caches each node's object and re-runs the factory
 * only when the accessor it is given is a different function, so a rebuild passes a new one, passing the same function
 * leaves every node with the shape it already had, which is a pinned node that never gets its frame.
 */
export function threeRenderer(graph: TGraphLib, nodeObject: (n: FGNode) => unknown): IGraphRenderer {
	return {
		size: (width, height) => void graph.width(width).height(height),
		draw: (drawn) => void graph.graphData(drawn),
		rebuildNodes: () => void graph.nodeThreeObject((n) => nodeObject(n)),
	};
}
