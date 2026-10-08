/**
 * Cookie helpers for SPA-side persistence. Each cookie these helpers set has a one-year max-age, path=/ and an encoded
 * value. `getJsonCookie` returns its fallback for a missing cookie or invalid JSON instead of throwing.
 */

import { jsonCarried } from "@haibun/core/lib/json-text.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Internal. A caller reads and writes a cookie through the JSON pair below. A component persists its options through
 *  `persistFields`, not through these functions. */
function getCookie(name: string): string {
	if (typeof document === "undefined") return "";
	const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
	return match ? decodeURIComponent(itemAt(match, 1)) : "";
}

/** A framed page sets a partitioned cookie, since a page in another site's frame can set only a partitioned cookie. The
 *  browser keys a partitioned cookie to the framing site, such as an extension's panel. A page shown on its own sets a
 *  first-party cookie. */
const framedAttributes = (): string => (window.top !== window ? "; SameSite=None; Secure; Partitioned" : "");

function setCookie(name: string, value: string): void {
	if (typeof document === "undefined") return;
	document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR}${framedAttributes()}`;
}

export function getJsonCookie<T>(name: string, fallback: T): T {
	const raw = getCookie(name);
	if (!raw) return fallback;
	const held = jsonCarried(raw);
	return held === undefined ? fallback : (held as T);
}

export function setJsonCookie(name: string, value: unknown): void {
	setCookie(name, JSON.stringify(value));
}
