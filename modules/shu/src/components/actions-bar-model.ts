/**
 * What the actions bar works out, apart from how it draws it: what the current selection is called, how tall the
 * expanded bar should be, and how far along a run the time cursor sits. Each is arithmetic over values the bar
 * already holds, so it can be read and tested without a browser, as `petitions-model.ts` is to its panel.
 */

import { clamp } from "../util.js";
import type { TContextPattern } from "../schemas.js";

/** What the bar knows about the view behind the selection, for when the patterns do not name one. */
export type TContextExtra = { total?: number; label?: string; folder?: string };

/** Height of the expanded bar as a fraction of its container: dragged, remembered, and bounded. */
export const PROPORTION = { min: 0.12, max: 0.9, default: 0.38 } as const;

/** A drag that leaves the bar shorter than this is a drag to nothing: the bar keeps a usable strip. */
export const MIN_PANEL_PX = 50;

/** Every pattern names a record: the reader has records selected, not a type to query over. */
export function isEntitySelection(patterns: TContextPattern[]): boolean {
	return patterns.length > 0 && patterns.every((p) => p.about === "record");
}

/**
 * What to call the current context: one selected record by its own name, several by their count, and a type by what
 * the view behind it holds. "All" when nothing is selected, since the bar then acts on everything.
 */
export function contextLabel(patterns: TContextPattern[], extra?: TContextExtra): string {
	if (patterns.length === 0) return "All";
	const records = patterns.filter((p) => p.about === "record");
	if (records.length === patterns.length) return records.length === 1 ? records[0].id : `${records.length} items`;
	const parts: string[] = [];
	const type = patterns.find((p) => p.about === "type");
	const label = extra?.label || type?.persistedAs;
	if (label) parts.push(`${label}:`);
	if (extra?.total !== undefined) parts.push(String(extra.total));
	if (extra?.folder) parts.push(`in ${extra.folder}`);
	return parts.length > 0 ? parts.join(" ") : "All";
}

/** The remembered height to open at: what was dragged, if that is still a height a reader can work in. */
export function openAtProportion(remembered: number): number {
	return remembered >= PROPORTION.min && remembered <= PROPORTION.max ? remembered : PROPORTION.default;
}

/** Where the top edge is now: the bar grows up from the bottom, so dragging up by ten pixels adds ten to its height. */
export function draggedHeight(startHeight: number, startY: number, y: number, containerHeight: number): number {
	return clamp(startHeight - (y - startY), MIN_PANEL_PX, containerHeight);
}

/** What a finished drag is remembered as: a fraction of the container, so the bar stays proportionate at any size. */
export function draggedProportion(height: number, containerHeight: number): number {
	return clamp(height / containerHeight, PROPORTION.min, PROPORTION.max);
}

/** A span in seconds or minutes, whichever reads shorter. */
const spanLabel = (ms: number): { n: number; unit: "s" | "m" } => {
	const seconds = Math.max(0, Math.round(ms / 1000));
	return seconds < 60 ? { n: seconds, unit: "s" } : { n: Math.round(seconds / 60), unit: "m" };
};

/**
 * How far along a run the time cursor sits: the moment it is at, out of how long the run is, "11/40s". A bare "11s"
 * says nothing about whether that is near the beginning or the end, which is the thing a reader wants from a readout
 * this small. "now" at the latest moment seen, since there is no upper bound to be a fraction of.
 */
export function timeOffsetLabel(cursor: number | null, firstEventTime: number, latestEventTime: number): string {
	if (cursor == null || cursor <= 0 || cursor >= latestEventTime) return "now";
	const at = spanLabel(cursor - firstEventTime);
	const whole = spanLabel(latestEventTime - firstEventTime);
	// One unit for both halves, so the two numbers can be read against each other.
	return at.unit === whole.unit ? `${at.n}/${whole.n}${whole.unit}` : `${Math.round((cursor - firstEventTime) / 1000)}/${whole.n * 60}s`;
}
