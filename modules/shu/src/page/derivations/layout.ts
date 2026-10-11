/**
 * The page's layout values: a docked pane's height as a share of the app, the height a drag of its top edge sets, and the
 * name of the actions bar's selection. Each reads values the view holds, so a test reads them without a browser.
 */
import { NOTHING_SELECTED_LABEL } from "../../schemas.js";
import { type TContextPattern, type TContextIndividual } from "@haibun/core/lib/conversation/domains/conversation.js";
import { DENOTES } from "@haibun/core/lib/typed-links.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import { statedTotal, type TCounted } from "@haibun/core/lib/hypermedia.js";

/** Constrains `x` to [min, max]. */
export const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));

/** Height of an open docked pane as a share of the app: dragged, remembered, and bounded. */
export const PROPORTION = { min: 0.12, max: 0.9, default: 0.38 } as const;

/** A drag doesn't leave a docked pane shorter than this, so the pane keeps a usable strip. */
export const MIN_PANEL_PX = 50;

/** Returns the share a docked pane opens at: the stored share where it is within the bounds, and the initial share
 *  otherwise. */
export function openAtProportion(remembered: number | undefined): number {
	return remembered !== undefined && remembered >= PROPORTION.min && remembered <= PROPORTION.max ? remembered : PROPORTION.default;
}

/** Returns the height a drag sets. A docked pane extends up from the bottom, so a drag up of ten pixels adds ten. */
export function draggedHeight(startHeight: number, startY: number, y: number, containerHeight: number): number {
	return clamp(startHeight - (y - startY), MIN_PANEL_PX, containerHeight);
}

/** Returns the share of the app a finished drag stores, so the pane keeps its share at any size of the app. */
export function draggedProportion(height: number, containerHeight: number): number {
	return clamp(height / containerHeight, PROPORTION.min, PROPORTION.max);
}

/** What the actions bar reads of the view behind the selection, where the selection's patterns don't name it. */
export type TContextExtra = { total?: TCounted; label?: string; folder?: string };

/** Whether every pattern names a record: the reader selected records, and not a type. */
export function isEntitySelection(patterns: TContextPattern[]): patterns is TContextIndividual[] {
	return patterns.length > 0 && patterns.every((p) => p.kind === DENOTES.individual);
}

/** Returns the name of the selection: one record by its id, several by their count, a type by the view's label or the
 *  type's name with the view's count and folder, and `NOTHING_SELECTED_LABEL` where the reader didn't select a record or a type. */
export function contextLabel(patterns: TContextPattern[], extra?: TContextExtra): string {
	if (patterns.length === 0) return NOTHING_SELECTED_LABEL;
	if (isEntitySelection(patterns)) return patterns.length === 1 ? itemAt(patterns, 0).id : `${patterns.length} items`;
	const parts: string[] = [`${extra?.label || patterns.find((p) => p.kind === DENOTES.type)?.persistedAs}:`];
	if (extra?.total !== undefined) parts.push(statedTotal(extra.total));
	if (extra?.folder) parts.push(`in ${extra.folder}`);
	return parts.join(" ");
}
