import { describe, it, expect } from 'vitest';

import { BrowserFactory, BROWSERS, DEFAULT_CONFIG_TAG } from "./BrowserFactory.js";
import { getTestWorldWithOptions } from "@haibun/core/lib/test/lib.js";

const launchOptions = {
	headless: true
}
const testWorld = getTestWorldWithOptions();
describe("types", () => {
	it("gets type and device", async () => {
		BrowserFactory.getBrowserFactory(testWorld, {
			options: {},
			browserType: BROWSERS.webkit,
			launchOptions,
			device: 'Blackberry PlayBook'
		});
		expect(BrowserFactory.configs[DEFAULT_CONFIG_TAG].device).toBe("Blackberry PlayBook");
		await BrowserFactory.closeBrowsers();
	});
});
