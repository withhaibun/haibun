/**
 * View-hash IO — the URL hash is the SPA's canonical view-state encoding. This
 * module owns reading and writing it, with an offline-mode fallback for the
 * standalone HTML snapshot (no window.location to mutate).
 *
 * Lives here, not on ShuElement, so server-side modules can import it without
 * pulling in HTMLElement.
 *
 * ARRIVALS are canonicalized here, before any consumer reads them: `open=` is the
 * ADDITIVE link form a static document uses — such a link cannot carry the rest of
 * the live state (label, sort, the other columns), so replacing the fragment with
 * it would drop them. The module-level hashchange listener below registers at
 * import time, ahead of every runtime listener (they all import this module), so
 * by the time pane-state or viewQuery reads the hash it is already canonical.
 */

let _offline = false;

export function setOffline(offline: boolean): void {
	_offline = offline;
}

export function isOffline(): boolean {
	return _offline;
}

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
}

if (typeof location !== "undefined") {
	// Boot arrival: the address itself is the only state there is, so it is its own merge base.
	_storedHash = canonicalizeArrival(location.hash, location.hash);
	if (_storedHash !== location.hash) replaceLocationHash(_storedHash);
	if (typeof addEventListener !== "undefined") addEventListener("hashchange", onHashArrival);
}

export function getHash(): string {
	return _offline ? _storedHash : typeof location !== "undefined" ? location.hash : "";
}

export function pushHash(newHash: string): void {
	_storedHash = newHash;
	if (_offline) return;
	if (typeof location === "undefined" || typeof history === "undefined") return;
	if (location.hash !== newHash) replaceLocationHash(newHash);
}

/** The page's own address without the hash — what an embedded body's `<base>` re-roots against.
 * An offline snapshot has no servable address, so none is offered. */
export function pageAddress(): string {
	if (_offline || typeof location === "undefined") return "";
	return location.origin + location.pathname + location.search;
}
