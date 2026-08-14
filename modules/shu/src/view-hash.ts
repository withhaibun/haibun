/**
 * View-hash IO — the URL hash is the SPA's canonical view-state encoding. This
 * module owns reading and writing it, with an offline-mode fallback for the
 * standalone HTML snapshot (no window.location to mutate).
 *
 * Lives here, not on ShuElement, so server-side modules can import it without
 * pulling in HTMLElement.
 *
 * Offline is not a flag this module keeps: it is which Conduit the app installed, read from hypermedia. A second flag
 * could disagree with the first, and the one a report was written under is the one that decides whether there is a
 * location to mutate.
 *
 * ARRIVALS are canonicalized here, before any consumer reads them: `open=` is the
 * ADDITIVE link form a static document uses — such a link cannot carry the rest of
 * the live state (label, sort, the other columns), so replacing the fragment with
 * it would drop them. The module-level hashchange listener below registers at
 * import time, ahead of every runtime listener (they all import this module), so
 * by the time pane-state or viewQuery reads the hash it is already canonical.
 */
import { isOffline } from "./hypermedia.js";

/** The hash body as URLSearchParams, tolerant of a leading `#` or `#?`. */
export function hashParams(hash: string): URLSearchParams {
	const body = hash.startsWith("#?") ? hash.slice(2) : hash.startsWith("#") ? hash.slice(1) : hash;
	return new URLSearchParams(body);
}

/**
 * Merge an `open=` arrival into `base` (the last canonical hash): each `open=` entry becomes a
 * `col=` entry and the last one becomes the active pane. Only the open entries are taken from the
 * arrival; everything else comes from the base. A hash without `open=` is already canonical.
 * The `~min`/`~max` strip is the pane flag suffix — grammar owned by pane-state's parseColEntry.
 */
export function canonicalizeArrival(hash: string, base: string): string {
	const params = hashParams(hash);
	const opened = params.getAll("open");
	if (opened.length === 0) return hash;
	const merged = hashParams(base);
	merged.delete("open");
	for (const entry of opened) merged.append("col", entry);
	merged.set("active", opened[opened.length - 1].replace(/~(min|max)$/, ""));
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

// The last canonical hash — the offline store, the merge base for `open=` arrivals, and (seeded at
// import, updated on every arrival and push) a mirror of location.hash.
let _storedHash = "";

function onHashArrival(): void {
	const arrived = location.hash;
	_storedHash = canonicalizeArrival(arrived, _storedHash);
	if (_storedHash !== arrived) replaceLocationHash(_storedHash);
	announce();
}

if (typeof location !== "undefined") {
	// Boot arrival: the address itself is the only state there is, so it is its own merge base.
	_storedHash = canonicalizeArrival(location.hash, location.hash);
	if (_storedHash !== location.hash) replaceLocationHash(_storedHash);
	if (typeof addEventListener !== "undefined") addEventListener("hashchange", onHashArrival);
}

/**
 * What a view subscribes to when it renders from the hash: the address arriving with one, and a view writing one
 * through history. A window `hashchange` covers only the first, and an offline snapshot raises neither, so a page
 * saved for reading offline would otherwise never hear its own deep links.
 */
const subscribers = new Set<() => void>();

export function onHashChanged(listener: () => void): () => void {
	subscribers.add(listener);
	return () => subscribers.delete(listener);
}

function announce(): void {
	for (const listener of subscribers) listener();
}

export function getHash(): string {
	return isOffline() ? _storedHash : typeof location !== "undefined" ? location.hash : "";
}

export function pushHash(newHash: string): void {
	_storedHash = newHash;
	if (isOffline()) return;
	if (typeof location === "undefined" || typeof history === "undefined") return;
	if (location.hash !== newHash) replaceLocationHash(newHash);
}

/** One param's value from the live hash, or "" when it carries none. */
export function hashParam(name: string): string {
	return hashParams(getHash()).get(name) ?? "";
}

/**
 * Merge params into the live hash, leaving every other one as it stands: an empty value removes its param. The
 * subscribers hear it, since the hash is written through history, which raises no event of its own, and a view
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

/** The page's own address without the hash — what an embedded body's `<base>` re-roots against.
 * An offline snapshot has no servable address, so none is offered. */
export function pageAddress(): string {
	if (isOffline() || typeof location === "undefined") return "";
	return location.origin + location.pathname + location.search;
}
