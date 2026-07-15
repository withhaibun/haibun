/**
 * Storage engine for `ShuElement.persistFields` — THE one mechanism for remembering per-component
 * UI options across reloads. Components never touch cookies directly: they declare the state fields
 * to persist (see ShuElement) and this module owns the medium. One cookie per component tag holding
 * `Record<instanceKey, persistedFields>`, so a tag's instances share one entry budget and a swap of
 * storage medium is a change to this file only.
 */
import { getJsonCookie, setJsonCookie } from "./cookies.js";

const COOKIE_PREFIX = "shu-prefs-";
/** Per-tag instance cap: oldest-written entries are evicted so per-instance keys (e.g. one per opened column) can't grow a cookie past its ~4KB budget. */
const MAX_INSTANCES = 24;
/** Trailing debounce for writes — absorbs per-frame bursts (a resize drag) into one cookie write. */
const PERSIST_DEBOUNCE_MS = 150;

type TPrefs = Record<string, Record<string, unknown>>;

export function readElementPrefs(tag: string, key: string): Record<string, unknown> | undefined {
	return getJsonCookie<TPrefs>(COOKIE_PREFIX + tag, {})[key];
}

export function writeElementPrefs(tag: string, key: string, fields: Record<string, unknown>): void {
	const name = COOKIE_PREFIX + tag;
	const all = getJsonCookie<TPrefs>(name, {});
	// Re-insert at the end: object insertion order is the eviction order (oldest first).
	delete all[key];
	if (Object.keys(fields).length > 0) all[key] = fields;
	const keys = Object.keys(all);
	for (let i = 0; i < keys.length - MAX_INSTANCES; i++) delete all[keys[i]];
	setJsonCookie(name, all);
}

const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; write: () => void }>();

/** Debounced write-through. `compute` runs at flush time so the latest state wins. Pending writes flush on pagehide so a reload right after a change can't lose it. */
export function schedulePersistWrite(tag: string, key: string, compute: () => Record<string, unknown>): void {
	const id = JSON.stringify([tag, key]);
	const prior = pending.get(id);
	if (prior) clearTimeout(prior.timer);
	const write = () => {
		pending.delete(id);
		writeElementPrefs(tag, key, compute());
	};
	pending.set(id, { timer: setTimeout(write, PERSIST_DEBOUNCE_MS), write });
}

/** Forget one instance's remembered options, dropping any write still owed for it — a pending write would otherwise
 *  land afterwards and restore them. For a view the reader has CLOSED: the options describe that view, so a later
 *  instance under the same identity opens with the defaults instead of inheriting them. */
export function forgetElementPrefs(tag: string, key: string): void {
	const id = JSON.stringify([tag, key]);
	const prior = pending.get(id);
	if (prior) {
		clearTimeout(prior.timer);
		pending.delete(id);
	}
	writeElementPrefs(tag, key, {});
}

/** Flush every pending debounced write immediately. pagehide uses it; tests may too. */
export function flushPersistWrites(): void {
	for (const { timer, write } of [...pending.values()]) {
		clearTimeout(timer);
		write();
	}
}

if (typeof window !== "undefined") window.addEventListener("pagehide", flushPersistWrites);
