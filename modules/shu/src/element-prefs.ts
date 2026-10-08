/**
 * Stores the fields `ShuElement.persistFields` names, so per-component UI options persist across reloads. It is the
 * only persistence mechanism for those options. Components don't read or write cookies: they declare the state fields
 * to persist (see ShuElement), and this module implements the storage. Each component tag has one cookie that holds
 * `Record<instanceKey, persistedFields>`. A tag's instances share one entry limit, and a change of storage medium
 * changes only this file.
 */
import { getJsonCookie, setJsonCookie } from "./cookies.js";

const COOKIE_PREFIX = "shu-prefs-";
/** The most instances a tag's cookie holds. A write evicts the oldest-written entries, so per-instance keys such as one
 *  per opened column don't exceed the cookie's ~4KB limit. */
const MAX_INSTANCES = 24;
/** Trailing debounce for writes. The debounce combines each burst of per-frame writes into one cookie write. A resize drag produces such a burst. */
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
	for (const evicted of keys.slice(0, -MAX_INSTANCES)) delete all[evicted];
	setJsonCookie(name, all);
}

const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; write: () => void }>();

/** Debounced write-through. `compute` runs at flush time, so the write holds the latest state. Pending writes flush on
 *  pagehide, so a change made right before a reload is written. */
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

/** Deletes one instance's persisted options and cancels its pending write, which would otherwise restore them. Call it
 *  for a view the reader closed. The options describe that view, so a later instance under the same key opens with the
 *  defaults. */
export function forgetElementPrefs(tag: string, key: string): void {
	const id = JSON.stringify([tag, key]);
	const prior = pending.get(id);
	if (prior) {
		clearTimeout(prior.timer);
		pending.delete(id);
	}
	writeElementPrefs(tag, key, {});
}

/** Flushes every pending debounced write immediately. The pagehide listener calls it, and tests can call it. */
export function flushPersistWrites(): void {
	for (const { timer, write } of [...pending.values()]) {
		clearTimeout(timer);
		write();
	}
}

if (typeof window !== "undefined") window.addEventListener("pagehide", flushPersistWrites);
