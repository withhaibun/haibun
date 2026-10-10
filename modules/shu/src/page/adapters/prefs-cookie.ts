/**
 * Stores elements' fields in cookies: one cookie per tag, holding each instance's fields by its key. A cookie holds at
 * most `MAX_INSTANCES` instances, and a write removes the instances written longest ago, so a key for each opened column
 * doesn't exceed a cookie's limit of about 4 KB. Each cookie lasts a year at the path `/`. A page in another site's frame
 * sets a partitioned cookie, which the browser keys to the framing site, since a framed page can't set another cookie.
 */
import { z } from "zod";
import { jsonCarried } from "@haibun/core/lib/json-text.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import type { TPreferences } from "../ports.js";

/** The prefix of each tag's cookie name. */
export const PREFERENCES_COOKIE_PREFIX = "shu-prefs-";
/** The most instances a tag's cookie holds. */
const MAX_INSTANCES = 24;
/** The trailing pause before a write. A drag that resizes a column changes its width on each frame and writes once. */
const WRITE_PAUSE_MS = 150;
const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** A tag's instances, each with its stored fields, in the order they were written. */
const InstancesSchema = z.record(z.string(), z.record(z.string(), z.unknown()));
type TInstances = z.infer<typeof InstancesSchema>;

/** Returns the preferences of `page`, stored in its cookies. */
export function cookiePreferences(page: Window): TPreferences {
	const { document } = page;
	const held = new Map<string, { timer: ReturnType<typeof setTimeout>; write: () => void; fields: () => Record<string, unknown> }>();
	const watchers = new Map<string, Set<(fields: Record<string, unknown> | undefined) => void>>();
	const idOf = (tag: string, key: string): string => JSON.stringify([tag, key]);

	/** Returns the instances a tag's cookie holds, and an empty record where the page doesn't hold the cookie. Throws where the
	 *  cookie holds something other than a record of instances, each a record of fields. */
	const instancesOf = (tag: string): TInstances => {
		const name = `${PREFERENCES_COOKIE_PREFIX}${tag}`;
		const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
		if (!match) return {};
		const parsed = InstancesSchema.safeParse(jsonCarried(decodeURIComponent(itemAt(match, 1))));
		if (!parsed.success) throw new Error(`the cookie ${name} doesn't hold a record of each instance's fields: ${errorDetail(parsed.error)}. Remove the cookie.`);
		return parsed.data;
	};

	/** Writes the instance's fields at the end of its tag's cookie, where the newest instances are kept. */
	const store = (tag: string, key: string, fields: Record<string, unknown>): void => {
		const instances = instancesOf(tag);
		delete instances[key];
		if (Object.keys(fields).length > 0) instances[key] = fields;
		for (const removed of Object.keys(instances).slice(0, -MAX_INSTANCES)) delete instances[removed];
		const framed = page.top !== page ? "; SameSite=None; Secure; Partitioned" : "";
		document.cookie = `${PREFERENCES_COOKIE_PREFIX}${tag}=${encodeURIComponent(JSON.stringify(instances))}; path=/; max-age=${ONE_YEAR_S}${framed}`;
	};

	const notify = (tag: string, key: string, fields: Record<string, unknown> | undefined): void => {
		const watching = watchers.get(idOf(tag, key));
		if (watching) for (const fn of watching) fn(fields);
	};

	const cancel = (id: string): void => {
		const pending = held.get(id);
		if (!pending) return;
		clearTimeout(pending.timer);
		held.delete(id);
	};

	const flush = (): void => {
		for (const { write } of [...held.values()]) write();
	};
	page.addEventListener("pagehide", flush);

	return {
		read: (tag, key) => {
			const pending = held.get(idOf(tag, key));
			return pending ? pending.fields() : instancesOf(tag)[key];
		},
		write: (tag, key, fields) => {
			const id = idOf(tag, key);
			cancel(id);
			const write = (): void => {
				cancel(id);
				store(tag, key, fields());
			};
			held.set(id, { timer: setTimeout(write, WRITE_PAUSE_MS), write, fields });
			notify(tag, key, fields());
		},
		forget: (tag, key) => {
			cancel(idOf(tag, key));
			store(tag, key, {});
			notify(tag, key, undefined);
		},
		flush,
		watch: (tag, key, fn) => {
			const id = idOf(tag, key);
			const watching = watchers.get(id);
			const set = watching === undefined ? new Set<(fields: Record<string, unknown> | undefined) => void>() : watching;
			watchers.set(id, set);
			set.add(fn);
			return () => set.delete(fn);
		},
	};
}
