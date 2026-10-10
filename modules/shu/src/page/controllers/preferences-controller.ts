/**
 * Stores the fields an element names in `persistFields` through the page's preferences, under its tag and its instance's
 * key. The element's first connection restores the stored fields, a change of a stored field writes them, and a write
 * by another instance under the same tag and key sets them, so instances that share a key show the same choices.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { pagePreferences } from "../root.js";

/** What the controller reads of its element: its tag, its instance's key (null until the element states it), the fields
 *  it stores, those fields as its state holds them, and how it sets stored fields: on its first connection (`initial`),
 *  or on another instance's write. */
export type TStoredFields = {
	tag: string;
	key(): string | null;
	names: readonly string[];
	fields(): Record<string, unknown>;
	restore(fields: Record<string, unknown>, initial: boolean): void;
};

export class PreferencesController implements ReactiveController {
	#restored = false;
	#writing = false;
	/** Whether a stored field changed before the first connection restored the stored fields. The write waits for the
	 *  restore, so it writes the restored fields with the changed ones. */
	#changedBeforeRestore = false;
	#stopWatching: (() => void) | undefined;

	constructor(
		host: ReactiveControllerHost,
		private readonly stored: TStoredFields,
	) {
		host.addController(this);
	}

	hostConnected(): void {
		const key = this.stored.key();
		if (this.stored.names.length === 0 || key === null) return;
		if (!this.#restored) {
			this.#restored = true;
			const saved = pagePreferences().read(this.stored.tag, key);
			if (saved) this.#restore(saved, true);
			if (this.#changedBeforeRestore) this.#write(key);
		}
		this.#stopWatching = pagePreferences().watch(this.stored.tag, key, (fields) => {
			if (!this.#writing && fields) this.#restore(fields, false);
		});
	}

	hostDisconnected(): void {
		this.#stopWatching?.();
		this.#stopWatching = undefined;
	}

	/** Writes the stored fields where `changed` names one of them. */
	changed(changed: readonly string[]): void {
		if (!changed.some((field) => this.stored.names.includes(field))) return;
		if (!this.#restored) {
			this.#changedBeforeRestore = true;
			return;
		}
		const key = this.stored.key();
		if (key !== null) this.#write(key);
	}

	#write(key: string): void {
		this.#writing = true;
		try {
			pagePreferences().write(this.stored.tag, key, () => this.stored.fields());
		} finally {
			this.#writing = false;
		}
	}

	/** Removes the instance's stored fields. A view the reader closes calls it, so the next view under its key opens with
	 *  its initial state. A view that is removed and returns, as on a reload, doesn't. */
	forget(): void {
		const key = this.stored.key();
		if (key !== null) pagePreferences().forget(this.stored.tag, key);
	}

	#restore(saved: Record<string, unknown>, initial: boolean): void {
		this.stored.restore(Object.fromEntries(this.stored.names.filter((name) => name in saved).map((name) => [name, saved[name]])), initial);
	}
}
