/**
 * What a docked pane works out, apart from how it draws it: how tall it opens as a share of the app, and where a drag of
 * its top edge leaves it. Each is arithmetic over values the pane already holds, so it is read and tested without a
 * browser.
 */
import { clamp } from "../util.js";

/** Height of an open docked pane as a share of the app: dragged, remembered, and bounded. */
export const PROPORTION = { min: 0.12, max: 0.9, default: 0.38 } as const;

/** A drag that leaves a docked pane shorter than this is a drag to nothing: the pane keeps a usable strip. */
export const MIN_PANEL_PX = 50;

/** The remembered height to open at: what was dragged, where that is still a height a reader can work in. */
export function openAtProportion(remembered: number | undefined): number {
	return remembered !== undefined && remembered >= PROPORTION.min && remembered <= PROPORTION.max ? remembered : PROPORTION.default;
}

/** Where the top edge is now: a docked pane grows up from the bottom, so dragging up by ten pixels adds ten to its height. */
export function draggedHeight(startHeight: number, startY: number, y: number, containerHeight: number): number {
	return clamp(startHeight - (y - startY), MIN_PANEL_PX, containerHeight);
}

/** What a finished drag is remembered as: a share of the app, so the pane stays proportionate at any size. */
export function draggedProportion(height: number, containerHeight: number): number {
	return clamp(height / containerHeight, PROPORTION.min, PROPORTION.max);
}
