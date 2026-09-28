import { pagePinned } from "./page-pinned.js";
import { isOffline } from "./rpc-registry.js";

/** The hash parameter that names one open column by its pane id, once for each column, in order. */
export const COLUMN_PARAM = "col";

/** The hash that names these columns, in this order: what a page starting on a run's views is given, the same form a
 *  reader's own layout is written in. */
export function hashWithColumns(columns: readonly string[]): string {
	const params = new URLSearchParams();
	for (const column of columns) params.append(COLUMN_PARAM, column);
	return `#?${params.toString()}`;
}

/** The hash body as URLSearchParams, tolerant of a leading `#` or `#?`. */
export function hashParams(hash: string): URLSearchParams {
	const body = hash.startsWith("#?") ? hash.slice(2) : hash.startsWith("#") ? hash.slice(1) : hash;
	return new URLSearchParams(body);
}

/** The endings of a `col=` or `open=` entry that state where its pane stands, after the pane's id. */
export const PANE_ENDING = { dock: "~dock", min: "~min", max: "~max" } as const;
type TPaneEnding = keyof typeof PANE_ENDING;

const endingOf = (entry: string): TPaneEnding | undefined => (Object.keys(PANE_ENDING) as TPaneEnding[]).find((name) => entry.endsWith(PANE_ENDING[name]));

/** An entry's pane id and the endings that follow it, in any order. */
export function splitPaneEntry(entry: string): { id: string; endings: Set<TPaneEnding> } {
	let id = entry;
	const endings = new Set<TPaneEnding>();
	for (let ending = endingOf(id); ending; ending = endingOf(id)) {
		endings.add(ending);
		id = id.slice(0, -PANE_ENDING[ending].length);
	}
	return { id, endings };
}

/**
 * Merge an `open=` arrival into `base` (the last canonical hash): each `open=` entry becomes a
 * `col=` entry and the last one becomes the active pane. Only the open entries are taken from the
 * arrival; everything else comes from the base. A hash without `open=` is already canonical.
 */
export function canonicalizeArrival(hash: string, base: string): string {
	const params = hashParams(hash);
	const opened = params.getAll("open");
	if (opened.length === 0) return hash;
	const merged = hashParams(base);
	merged.delete("open");
	for (const entry of opened) merged.append(COLUMN_PARAM, entry);
	merged.set("active", splitPaneEntry(opened[opened.length - 1]).id);
	return `#?${merged.toString()}`;
}

function replaceLocationHash(newHash: string): void {
	if (typeof history === "undefined") return;
	try {
		history.replaceState(null, "", newHash);
	} catch {
		/* file:// security restriction */
	}
}

/**
 * The page's hash, which every bundle on the page reads and writes, so a view in one bundle hears a hash a view in
 * another pushes. `stored` is the last canonical hash: the offline store, the merge base for `open=` arrivals, and a
 * mirror of location.hash, updated on every arrival and push. `subscribers` are the views that render from it.
 */
type TPageHash = { stored: string; subscribers: Set<() => void> };
const PAGE_HASH_KEY = "__SHU_PAGE_HASH__";
const pageHash = (): TPageHash => pagePinned(PAGE_HASH_KEY, arriveAtBoot, departPage);

/** The boot arrival: the address itself is the only state there is, so it is its own merge base. The page listens for
 *  later arrivals once, from the bundle that holds its hash first. */
function arriveAtBoot(): TPageHash {
	const held: TPageHash = { stored: "", subscribers: new Set() };
	if (typeof location === "undefined") return held;
	held.stored = canonicalizeArrival(location.hash, location.hash);
	if (held.stored !== location.hash) replaceLocationHash(held.stored);
	if (typeof addEventListener !== "undefined") addEventListener("hashchange", onHashArrival);
	return held;
}

function departPage(): void {
	if (typeof removeEventListener !== "undefined") removeEventListener("hashchange", onHashArrival);
}

function onHashArrival(): void {
	const held = pageHash();
	const arrived = location.hash;
	held.stored = canonicalizeArrival(arrived, held.stored);
	if (held.stored !== arrived) replaceLocationHash(held.stored);
	announce();
}

// At import, so the arrival listener runs before any a view adds later and a view reads the canonical hash.
pageHash();

/**
 * What a view subscribes to when it renders from the hash: the address arriving with one, and a view writing one
 * through history. A window `hashchange` covers only the first, and an offline snapshot doesn't raise either, so a page
 * saved for reading offline would otherwise never hear its own deep links.
 */
export function onHashChanged(listener: () => void): () => void {
	const { subscribers } = pageHash();
	subscribers.add(listener);
	return () => subscribers.delete(listener);
}

function announce(): void {
	for (const listener of pageHash().subscribers) listener();
}

export function getHash(): string {
	return isOffline() ? pageHash().stored : typeof location !== "undefined" ? location.hash : "";
}

export function pushHash(newHash: string): void {
	pageHash().stored = newHash;
	if (isOffline()) return;
	if (typeof location === "undefined" || typeof history === "undefined") return;
	if (location.hash !== newHash) replaceLocationHash(newHash);
}

/** One param's value from the live hash, or "" when it doesn't carry one. */
export function hashParam(name: string): string {
	return hashParams(getHash()).get(name) ?? "";
}

/**
 * Merge params into the live hash, leaving every other one as it stands: an empty value removes its param. The
 * subscribers hear it, since the hash is written through history, which doesn't raise an event of its own, and a view
 * reading the same param has to hear that it moved.
 */
export function mergeHashParams(values: Record<string, string>): void {
	const params = hashParams(getHash());
	for (const [name, value] of Object.entries(values)) {
		if (value) params.set(name, value);
		else params.delete(name);
	}
	const next = `#?${params.toString()}`;
	if (next === getHash()) return;
	pushHash(next);
	announce();
}

/** The page's own address without the hash: what an embedded body's `<base>` re-roots against.
 * An offline snapshot doesn't have a servable address, so this doesn't offer one. */
export function pageAddress(): string {
	if (isOffline() || typeof location === "undefined") return "";
	return location.origin + location.pathname + location.search;
}
