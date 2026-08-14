/**
 * The one mapping between a canvas pixel and normalised device coordinates — the two directions the graph reads it in:
 * projecting a node OUT to the pixel it draws at, and picking a pointer's pixel back IN to the ray that hits it.
 *
 * These are exact inverses, and they must stay so: the graph projects a node to aim at it and raycasts that same pixel
 * to identify it, so any drift between the two directions means a node cannot be picked where it is drawn. Kept pure —
 * rect arithmetic, no camera and no THREE — so the property is provable without a browser (fisheye-project.test.ts),
 * leaving only the raycast itself to need one.
 */

/** Normalised device coordinates run -1..1 on each axis (y up), so the box's edge is 1 and its full extent is 2. */
export const NDC_EDGE = 1;
export const NDC_SPAN = NDC_EDGE * 2;

/** The part of a canvas' client rect a projection maps into. */
export type TCanvasRect = { left: number; top: number; width: number; height: number };

/** A point in normalised device coordinates. */
export type TNdc = { x: number; y: number };

/** A point in client (viewport) pixels, as a pointer event carries them. */
export type TClientPoint = { x: number; y: number };

/** Where NDC lands on screen — the pixel a node projected to `ndc` is drawn at. */
export function ndcToClient(ndc: TNdc, rect: TCanvasRect): TClientPoint {
	return { x: rect.left + ((ndc.x + NDC_EDGE) / NDC_SPAN) * rect.width, y: rect.top + ((NDC_EDGE - ndc.y) / NDC_SPAN) * rect.height };
}

/** What NDC a screen pixel names — the coordinates a pick ray is cast from. The inverse of `ndcToClient`. */
export function clientToNdc(point: TClientPoint, rect: TCanvasRect): TNdc {
	return { x: ((point.x - rect.left) / rect.width) * NDC_SPAN - NDC_EDGE, y: NDC_EDGE - ((point.y - rect.top) / rect.height) * NDC_SPAN };
}

/** True when NDC falls inside the viewport box — what "on screen" means for a projected node. */
export function ndcOnScreen(ndc: TNdc): boolean {
	return Math.abs(ndc.x) <= NDC_EDGE && Math.abs(ndc.y) <= NDC_EDGE;
}
