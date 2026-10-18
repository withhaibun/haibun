/**
 * The page's address: the hash parameters that name its columns and its active pane, the one form every hash the page
 * writes takes, an entry's pane and the endings that place it, and an arrival's canonical form.
 */
import { itemAt } from "@haibun/core/lib/domains/item-at.js";

/** The hash parameter that names one open column by its pane id, once for each column, in order. */
export const COLUMN_PARAM = "col";

/** The hash parameter that names the active pane by its pane id. */
export const ACTIVE_PARAM = "active";

/** The hash parameter a static document's link names a pane to open with, which an arrival merges into the page's hash. */
const OPEN_PARAM = "open";

/** Returns the hash that states `params`. */
export const hashOf = (params: URLSearchParams): string => `#?${params.toString()}`;

/** Returns the hash that names `columns` in their order, and sets each parameter of `state` where it is stated. A page that
 *  starts on actuality's views is given it, and a link to a view opened with its state addresses it. */
export function hashWithColumns(columns: readonly string[], state?: Readonly<Record<string, string>>): string {
	const params = new URLSearchParams();
	for (const column of columns) params.append(COLUMN_PARAM, column);
	if (state !== undefined) for (const [name, value] of Object.entries(state)) params.set(name, value);
	return hashOf(params);
}

/** Returns the parameters of `hash`. A leading `#?` or `#` is optional. */
export function hashParams(hash: string): URLSearchParams {
	const body = hash.startsWith("#?") ? hash.slice(2) : hash.startsWith("#") ? hash.slice(1) : hash;
	return new URLSearchParams(body);
}

/** The endings of a `col=` or `open=` entry that state where its pane stands, after the pane's id. */
export const PANE_ENDING = { dock: "~dock", min: "~min", max: "~max" } as const;
type TPaneEnding = keyof typeof PANE_ENDING;

const endingOf = (entry: string): TPaneEnding | undefined => (Object.keys(PANE_ENDING) as TPaneEnding[]).find((name) => entry.endsWith(PANE_ENDING[name]));

/** Returns an entry's pane id and the endings that follow it, in any order. */
export function splitPaneEntry(entry: string): { id: string; endings: Set<TPaneEnding> } {
	let id = entry;
	const endings = new Set<TPaneEnding>();
	for (let ending = endingOf(id); ending; ending = endingOf(id)) {
		endings.add(ending);
		id = id.slice(0, -PANE_ENDING[ending].length);
	}
	return { id, endings };
}

/** Returns the canonical form of an arrival at `hash`, merged into `base`, the page's last canonical hash. Each `open=`
 *  entry becomes a `col=` entry, and the last one becomes the active pane. The merge takes only the `open=` entries of
 *  the arrival, and every other parameter from `base`. A hash without `open=` is canonical. */
export function canonicalizeArrival(hash: string, base: string): string {
	const opened = hashParams(hash).getAll(OPEN_PARAM);
	if (opened.length === 0) return hash;
	const merged = hashParams(base);
	merged.delete(OPEN_PARAM);
	for (const entry of opened) merged.append(COLUMN_PARAM, entry);
	merged.set(ACTIVE_PARAM, splitPaneEntry(itemAt(opened, opened.length - 1)).id);
	return hashOf(merged);
}

/** Returns the hash that states the parameters of the address's query `search`, or undefined where the query doesn't state
 *  one. A page opened at `?label=Researcher` opens at `#?label=Researcher`. */
export function hashFromQuery(search: string): string | undefined {
	const params = new URLSearchParams(search);
	return params.size === 0 ? undefined : hashOf(params);
}
