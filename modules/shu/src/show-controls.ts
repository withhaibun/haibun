/**
 * Per-component show-controls preference, stored as a single cookie keyed by tag.
 * Pure module — no HTMLElement reference — so server-side importers (pane-state,
 * monitor-stepper) can pull it without dragging in the browser-only base class.
 */
import { getJsonCookie, setJsonCookie } from "./cookies.js";

const SHOW_CONTROLS_COOKIE = "shu-show-controls";

/** Components default to OFF — a fresh user sees graph/fisheye/etc. without settings rows. */
export function readShowControlsCookie(componentTag: string): boolean {
	return Boolean(getJsonCookie<Record<string, boolean>>(SHOW_CONTROLS_COOKIE, {})[componentTag]);
}

export function writeShowControlsCookie(componentTag: string, show: boolean): void {
	const map = getJsonCookie<Record<string, boolean>>(SHOW_CONTROLS_COOKIE, {});
	map[componentTag] = show;
	setJsonCookie(SHOW_CONTROLS_COOKIE, map);
}
