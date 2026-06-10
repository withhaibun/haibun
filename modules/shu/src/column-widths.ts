/**
 * Per-column width persistence: a cookie mapping a pane's `columnKey` to its user-resized width, so reopening
 * a column (the URL hash restores the trail on reload) restores the width the user chose. The query pane is the
 * one fixed root pane and persists separately (shu-query-width); these are the dynamic subject columns.
 */
import { getJsonCookie, setJsonCookie } from "./cookies.js";

const COLUMN_WIDTHS_COOKIE = "shu-column-widths";

export function savedColumnWidth(columnKey: string): number | undefined {
	return getJsonCookie<Record<string, number>>(COLUMN_WIDTHS_COOKIE, {})[columnKey];
}

export function saveColumnWidth(columnKey: string, width: number): void {
	const all = getJsonCookie<Record<string, number>>(COLUMN_WIDTHS_COOKIE, {});
	all[columnKey] = width;
	setJsonCookie(COLUMN_WIDTHS_COOKIE, all);
}
