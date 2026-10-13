/** The browser factory's holdings: a page it opens is its own, and a feature's end closes only what it opened. */
import { describe, expect, it } from "vitest";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { browserPorts, closeBrowsers } from "../root.js";

const unobserved = { request: () => undefined, response: () => undefined, navigated: () => undefined };
const launched = { options: {}, browserType: "chromium" as const, launchOptions: { headless: true, devtools: false, args: [] } };

describe("the browser factory", () => {
	it("holds the page it opens for a tab, as its own, until the feature's context closes", { timeout: 30_000 }, async () => {
		const pages = browserPorts(
			getDefaultWorld(),
			() => launched,
			() => unobserved,
		).openPages();
		const page = await pages.page(0, 0);
		expect(await pages.page(0, 0), "the tab's page is held").toBe(page);
		expect(pages.hasPage(0, 0)).toBe(true);
		expect(pages.isAdopted(page), "a page actuality opened is its own").toBe(false);
		await pages.closeContext(0);
		expect(page.isClosed(), "the feature's end closes the page it opened").toBe(true);
		expect(pages.hasPage(0, 0)).toBe(false);
		await closeBrowsers();
	});
});
