// @vitest-environment jsdom
/**
 * How the page keeps a cookie: first-party where it is shown on its own, and partitioned where another site frames it,
 * since a frame may set only a partitioned cookie, which stays with the site that frames it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { setJsonCookie } from "./cookies.js";

/** Each cookie the page writes, as it writes it. */
function writing(): { written: string[]; restore: () => void } {
	const written: string[] = [];
	const owned = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
	Object.defineProperty(document, "cookie", { configurable: true, get: () => "", set: (cookie: string) => void written.push(cookie) });
	return { written, restore: () => owned && Object.defineProperty(document, "cookie", owned) };
}

describe("how the page keeps a cookie", () => {
	let restore: (() => void) | undefined;
	afterEach(() => restore?.());

	it("keeps a first-party cookie where the page is shown on its own", () => {
		const page = writing();
		restore = page.restore;
		setJsonCookie("shu-prefs-a", { mode: "ask" });
		expect(page.written).toHaveLength(1);
		expect(page.written[0]).not.toContain("SameSite");
	});

	it("keeps a partitioned cookie where another site frames the page", () => {
		const page = writing();
		const top = Object.getOwnPropertyDescriptor(window, "top");
		Object.defineProperty(window, "top", { configurable: true, get: () => ({}) });
		restore = () => {
			page.restore();
			if (top) Object.defineProperty(window, "top", top);
		};
		setJsonCookie("shu-prefs-a", { mode: "ask" });
		expect(page.written[0]).toMatch(/; SameSite=None; Secure; Partitioned$/);
	});
});
