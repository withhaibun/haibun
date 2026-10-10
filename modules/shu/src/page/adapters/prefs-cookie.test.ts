// @vitest-environment jsdom
/**
 * The cookie each tag's stored fields are kept in: first-party where the page is shown on its own, partitioned where
 * another site frames the page, and holding at most 24 instances.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cookiePreferences, PREFERENCES_COOKIE_PREFIX } from "./prefs-cookie.js";

/** Each cookie the page writes, as it writes it, and the cookie the page reads back. */
function writing(): { written: string[]; restore: () => void } {
	const written: string[] = [];
	const owned = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
	Object.defineProperty(document, "cookie", { configurable: true, get: () => "", set: (cookie: string) => void written.push(cookie) });
	return { written, restore: () => owned && Object.defineProperty(document, "cookie", owned) };
}

describe("the cookie of a tag's stored fields", () => {
	let restore: (() => void) | undefined;
	afterEach(() => {
		restore?.();
		restore = undefined;
	});

	it("is first-party where the page is shown on its own", () => {
		const page = writing();
		restore = page.restore;
		const preferences = cookiePreferences(window);
		preferences.write("shu-probe", "", () => ({ mode: "ask" }));
		preferences.flush();
		expect(page.written).toHaveLength(1);
		expect(page.written[0]).not.toContain("SameSite");
	});

	it("is partitioned where another site frames the page", () => {
		const page = writing();
		const top = Object.getOwnPropertyDescriptor(window, "top");
		Object.defineProperty(window, "top", { configurable: true, get: () => ({}) });
		restore = () => {
			page.restore();
			if (top) Object.defineProperty(window, "top", top);
		};
		const preferences = cookiePreferences(window);
		preferences.write("shu-probe", "", () => ({ mode: "ask" }));
		preferences.flush();
		expect(page.written[0]).toMatch(/; SameSite=None; Secure; Partitioned$/);
	});

	it("holds the 24 instances written last", () => {
		const preferences = cookiePreferences(window);
		for (let i = 0; i < 30; i++) {
			preferences.write("shu-probe", `k${i}`, () => ({ size: i }));
			preferences.flush();
		}
		expect(preferences.read("shu-probe", "k0")).toBeUndefined();
		expect(preferences.read("shu-probe", "k6")).toEqual({ size: 6 });
		expect(preferences.read("shu-probe", "k29")).toEqual({ size: 29 });
		document.cookie = `${PREFERENCES_COOKIE_PREFIX}shu-probe=; path=/; max-age=0`;
	});

	it("calls each watcher of an instance with its fields at once, returns them to a read, and writes the latest fields after the pause", () => {
		const preferences = cookiePreferences(window);
		const seen: unknown[] = [];
		const stop = preferences.watch("shu-probe", "", (fields) => seen.push(fields));
		let size = 1;
		preferences.write("shu-probe", "", () => ({ size }));
		size = 2;
		expect(preferences.read("shu-probe", ""), "a read returns the held write's latest fields").toEqual({ size: 2 });
		expect(document.cookie, "the cookie holds the write after the pause").not.toContain(PREFERENCES_COOKIE_PREFIX);
		preferences.flush();
		expect(document.cookie).toContain(PREFERENCES_COOKIE_PREFIX);
		preferences.forget("shu-probe", "");
		stop();
		expect(seen).toEqual([{ size: 1 }, undefined]);
	});
});
