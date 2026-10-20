/**
 * How a camera shows a set of nodes, for a test that holds the camera to framing the graph: how many of the nodes project
 * on screen and how much of the view their projection spans.
 */
import { NDC_EDGE, NDC_SPAN, type TNdc } from "../page/graph/derivations/project.js";

/** True when NDC falls inside the viewport box: what "on screen" means for a projected node. */
export function ndcOnScreen(ndc: TNdc): boolean {
	return Math.abs(ndc.x) <= NDC_EDGE && Math.abs(ndc.y) <= NDC_EDGE;
}

/** A node projected through the camera: its NDC, and its depth, which exceeds NDC_EDGE past the far plane or behind the camera. */
export type TProjected = TNdc & { z: number };

/** How a camera shows a set of nodes: how many project on screen, their share of the total, and the share of the view
 *  their projected bounds span on the wider axis. */
type TScreenShare = { total: number; onScreen: number; fraction: number; span: number };

/** The camera frames the graph when this share of its nodes projects on screen and its projection spans this share of the view. */
const FRAMED_ON_SCREEN = 0.9;
export const FRAMED_SPAN = 0.2;

/** The screen share of `projected`. A node past the far plane or behind the camera is off screen and outside the span. */
export function screenShare(projected: readonly TProjected[]): TScreenShare {
	let onScreen = 0;
	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const v of projected) {
		if (v.z > NDC_EDGE) continue;
		if (ndcOnScreen(v)) onScreen++;
		minX = Math.min(minX, v.x);
		maxX = Math.max(maxX, v.x);
		minY = Math.min(minY, v.y);
		maxY = Math.max(maxY, v.y);
	}
	const span = Math.max(maxX - minX, maxY - minY) / NDC_SPAN;
	const total = projected.length;
	return { total, onScreen, fraction: total ? onScreen / total : 1, span: Number.isFinite(span) ? span : 0 };
}

/** Whether a camera that shows the graph at `share` frames it: nearly every node on screen, at a usable size. */
export function framesGraph(share: TScreenShare): boolean {
	return share.fraction >= FRAMED_ON_SCREEN && share.span >= FRAMED_SPAN;
}
