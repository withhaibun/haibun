/**
 * The ports of a page's reads and writes. `page/root.ts` installs one adapter for each on the page, and every bundle on the
 * page reads the installed one.
 */

/** An element's stored fields, by its tag and its instance's key. Each tag holds one record of its instances' fields. */
export type TPreferences = {
	/** Returns the fields stored for the instance `key` of `tag`, a held write's fields first, or undefined where it doesn't
	 *  hold any. */
	read(tag: string, key: string): Record<string, unknown> | undefined;
	/** Stores the fields `fields` returns for the instance `key` of `tag`. Each watcher of the instance receives them at once,
	 *  and the store writes them after a trailing pause, from a second call of `fields`, so a burst of changes writes once
	 *  with the latest values. */
	write(tag: string, key: string, fields: () => Record<string, unknown>): void;
	/** Removes the instance's stored fields and the write it holds for them, so the next instance opens with its initial
	 *  state. */
	forget(tag: string, key: string): void;
	/** Writes every held write now. */
	flush(): void;
	/** Calls `fn` with the instance's fields on each write or removal of them. Returns the call that stops it. */
	watch(tag: string, key: string, fn: (fields: Record<string, unknown> | undefined) => void): () => void;
};

/** The page's time: the instant now, a call after a delay, and a call on the next frame the browser draws. */
export type TClock = {
	/** Returns the instant now, in epoch milliseconds. */
	now(): number;
	/** Calls `fn` after `ms` milliseconds. Returns the call that cancels it. */
	after(ms: number, fn: () => void): () => void;
	/** Calls `fn` before the browser draws its next frame. Returns the call that cancels it. */
	frame(fn: () => void): () => void;
};
