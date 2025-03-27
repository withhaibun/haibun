import { describe, it, expect } from 'vitest';

import { BrowserFactory, BROWSERS, DEFAULT_CONFIG_TAG } from "./BrowserFactory.js";
import { getDefaultTag, getTestWorldWithOptions } from "@haibun/core/build/lib/test/lib.js";

const launchOptions = {
	headless: true
}
const testWorld = getTestWorldWithOptions({ options: { DEST: 'foo' }, moduleOptions: {} });
describe("types", () => {
	it("gets type and device", async () => {
		await BrowserFactory.getBrowserFactory(testWorld, {
			options: {},
			browserType: BROWSERS.webkit,
			launchOptions: {
				...launchOptions,
			},
			device: 'Blackberry PlayBook'
		});
		expect(BrowserFactory.configs[DEFAULT_CONFIG_TAG].device).toBe("Blackberry PlayBook");
		await BrowserFactory.closeBrowsers();
	});
});

describe('browser, context, page', () => {
	it.skip('page, context and browser', async () => {
		const bfa = await BrowserFactory.getBrowserFactory(testWorld, {
			options: {},
			browserType: BROWSERS.chromium,
			launchOptions
		});
		const test = getDefaultTag(0);
		const test2 = getDefaultTag(1);
		const pa1 = await bfa.getBrowserContextPage(test, 0);
		expect(pa1).toBeDefined();
		expect(Object.keys(BrowserFactory.browsers).length).toBe(1)
		expect(Object.keys(bfa.browserContexts).length).toBe(1)
		/*

		const pa2 = await bfa.getBrowserContextPage(test2);
		expect(pa2).toBeDefined();
		expect(Object.keys(BrowserFactory.browsers).length).toBe(1)
		expect(Object.keys(bfa.contexts).length).toBe(2)
		expect((pa1 as PageInstance)._guid).not.toEqual((pa2 as PageInstance)._guid);

		const pa3 = await bfa.getBrowserContextPage(test2);
		expect(pa3).toBeDefined();
		expect(Object.keys(BrowserFactory.browsers).length).toBe(1)
		expect(Object.keys(bfa.contexts).length).toBe(2)
		expect((pa2 as PageInstance)._guid).toEqual((pa3 as PageInstance)._guid);

		const bfb = await BrowserFactory.getBrowserFactory(logger, browserContextOptions);
		expect(Object.keys(BrowserFactory.browsers).length).toBe(1)
		expect(Object.keys(bfb.contexts).length).toBe(1)

		expect(Object.keys(bfa.contexts).length).toBe(2)

		await bfa.closeContext(test2);

		expect(Object.keys(bfa.contexts).length).toBe(1)
		expect(bfa.pages['test2']).toBeUndefined();
		*/
		await BrowserFactory.closeBrowsers();
	});

});
