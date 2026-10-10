/**
 * Reads a page setting that another element stores, and follows each change of it. A view that windows its reads holds
 * one for the window size, which `<shu-window-size>` stores, and reads again when the reader chooses another size.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { z } from "zod";
import { pagePreferences } from "../root.js";
import { PAGE_SETTING_KEY } from "../domains/settings.js";
import { storedSetting } from "../derivations/settings.js";

/** Returns the setting `tag` stored, or `initial` where it didn't store one, and throws where the stored fields don't match
 *  `schema`. The page's start reads the theme through it,
 *  before an element connects. */
export const readSetting = <T>(tag: string, schema: z.ZodType<T>, initial: T): T => storedSetting(`<${tag}>`, schema, pagePreferences().read(tag, PAGE_SETTING_KEY), initial);

/** Stores `fields` for the instance `key` of `tag`. A view stores a choice another element of the page reads through it,
 *  as a column pane stores whether its view's controls show. */
export const storeFields = (tag: string, key: string, fields: Record<string, unknown>): void => pagePreferences().write(tag, key, () => fields);

/** Returns the fields stored for the instance `key` of `tag`, or undefined where the page doesn't store them. */
export const storedFields = (tag: string, key: string): Record<string, unknown> | undefined => pagePreferences().read(tag, key);

export class SettingController<T> implements ReactiveController {
	#value: T;
	#stopWatching: (() => void) | undefined;

	/** `tag` is the element that stores the setting, `schema` parses its stored fields, `initial` is the setting where the
	 *  element didn't store it, and `changed` runs on each change after the host's first connection. */
	constructor(
		private readonly host: ReactiveControllerHost,
		private readonly tag: string,
		private readonly schema: z.ZodType<T>,
		private readonly initial: T,
		private readonly changed: (value: T) => void,
	) {
		this.#value = storedSetting(`<${tag}>`, schema, pagePreferences().read(tag, PAGE_SETTING_KEY), initial);
		host.addController(this);
	}

	get value(): T {
		return this.#value;
	}

	hostConnected(): void {
		this.#value = storedSetting(`<${this.tag}>`, this.schema, pagePreferences().read(this.tag, PAGE_SETTING_KEY), this.initial);
		this.#stopWatching = pagePreferences().watch(this.tag, PAGE_SETTING_KEY, (fields) => {
			this.#value = storedSetting(`<${this.tag}>`, this.schema, fields, this.initial);
			this.host.requestUpdate();
			this.changed(this.#value);
		});
	}

	hostDisconnected(): void {
		this.#stopWatching?.();
		this.#stopWatching = undefined;
	}
}
