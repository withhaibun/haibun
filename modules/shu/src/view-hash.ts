/**
 * View-hash IO — the URL hash is the SPA's canonical view-state encoding. This
 * module owns reading and writing it, with an offline-mode fallback for the
 * standalone HTML snapshot (no window.location to mutate).
 *
 * Lives here, not on ShuElement, so server-side modules can import it without
 * pulling in HTMLElement.
 */

let _offline = false;
let _storedHash = "";

export function setOffline(offline: boolean): void {
	_offline = offline;
}

export function isOffline(): boolean {
	return _offline;
}

export function getHash(): string {
	return _offline ? _storedHash : typeof location !== "undefined" ? location.hash : "";
}

export function pushHash(newHash: string): void {
	_storedHash = newHash;
	if (_offline) return;
	if (typeof location === "undefined" || typeof history === "undefined") return;
	try {
		if (location.hash !== newHash) history.replaceState(null, "", newHash);
	} catch {
		/* file:// security restriction */
	}
}
