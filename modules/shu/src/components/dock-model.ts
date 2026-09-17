/**
 * A docked pane's arithmetic: the height it opens at as a share of the app, and the height a drag of its top edge gives
 * it. Both read values the pane already holds, so a test reads them without a browser.
 */
import { clamp } from "../util.js";

/** Height of an open docked pane as a share of the app: dragged, remembered, and bounded. */
export const PROPORTION = { min: 0.12, max: 0.9, default: 0.38 } as const;

/** A drag that leaves a docked pane shorter than this is a drag to nothing: the pane keeps a usable strip. */
export const MIN_PANEL_PX = 50;

/** The height to open at. It is the remembered height, where a reader can still work in it, and the default otherwise. */
export function openAtProportion(remembered: number | undefined): number {
	return remembered !== undefined && remembered >= PROPORTION.min && remembered <= PROPORTION.max ? remembered : PROPORTION.default;
}

/** The height a drag gives the pane. A docked pane grows up from the bottom, so a drag up of ten pixels adds ten. */
export function draggedHeight(startHeight: number, startY: number, y: number, containerHeight: number): number {
	return clamp(startHeight - (y - startY), MIN_PANEL_PX, containerHeight);
}

/** The share of the app a finished drag is remembered as, so the pane keeps its proportion at any size. */
export function draggedProportion(height: number, containerHeight: number): number {
	return clamp(height / containerHeight, PROPORTION.min, PROPORTION.max);
}
