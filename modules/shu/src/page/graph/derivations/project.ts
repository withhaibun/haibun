/**
 * The one mapping between a canvas pixel and normalised device coordinates: the two directions the graph reads it in:
 * projecting a node OUT to the pixel it draws at, and picking a pointer's pixel back IN to the ray that hits it.
 *
 * These are exact inverses, and they must stay so: the graph projects a node to aim at it and raycasts that same pixel
 * to identify it, so any drift between the two directions means a node cannot be picked where it is drawn. Kept pure:
 * rect arithmetic without a camera or THREE, so the property is provable without a browser (polymorphic-project.test.ts),
 * leaving only the raycast itself to need one.
 */

/** Normalised device coordinates run -1..1 on each axis (y up), so the box's edge is 1 and its full extent is 2. */
export const NDC_EDGE = 1;
export const NDC_SPAN = NDC_EDGE * 2;

/** The part of a canvas' client rect that a projection fills. */
export type TCanvasRect = { left: number; top: number; width: number; height: number };

/** A point in normalised device coordinates. */
export type TNdc = { x: number; y: number };

/** A point in client (viewport) pixels, as a pointer event carries them. */
export type TClientPoint = { x: number; y: number };

/** Where NDC lands on screen: the pixel that draws a node projected to `ndc`. */
export function ndcToClient(ndc: TNdc, rect: TCanvasRect): TClientPoint {
	return { x: rect.left + ((ndc.x + NDC_EDGE) / NDC_SPAN) * rect.width, y: rect.top + ((NDC_EDGE - ndc.y) / NDC_SPAN) * rect.height };
}

/** What NDC a screen pixel names: the origin of a pick ray. The inverse of `ndcToClient`. */
export function clientToNdc(point: TClientPoint, rect: TCanvasRect): TNdc {
	return { x: ((point.x - rect.left) / rect.width) * NDC_SPAN - NDC_EDGE, y: NDC_EDGE - ((point.y - rect.top) / rect.height) * NDC_SPAN };
}

/** True when NDC falls inside the viewport box: what "on screen" means for a projected node. */
export function ndcOnScreen(ndc: TNdc): boolean {
	return Math.abs(ndc.x) <= NDC_EDGE && Math.abs(ndc.y) <= NDC_EDGE;
}

/** A node projected through the camera: its NDC, and its depth, which exceeds NDC_EDGE past the far plane or behind the camera. */
export type TProjected = TNdc & { z: number };

/** How a camera shows a set of nodes: how many project on screen, their share of the total, and the share of the view
 *  their projected bounds span on the wider axis. */
export type TScreenShare = { total: number; onScreen: number; fraction: number; span: number };

/** The camera frames the graph when this share of its nodes projects on screen and its projection spans this share of the view. */
export const FRAMED_ON_SCREEN = 0.9;
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
