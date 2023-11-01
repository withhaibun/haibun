import Logger, { LOGGER_NOTHING } from "@haibun/core/build/lib/Logger.js";
import { BrowserFactory, DEFAULT_CONFIG_TAG, TBrowserFactoryOptions } from "./BrowserFactory.js";
import { getDefaultTag } from "@haibun/core/build/lib/test/lib.js";

const browserContextOptions = {
  browser: {
    headless: true
  },
}

describe("types", () => {
  it("gets type and device", async () => {
    await BrowserFactory.getBrowserFactory(new Logger(LOGGER_NOTHING), {
      ...browserContextOptions,
      type: 'webkit',
      device: 'Blackberry PlayBook'
    });
    expect(BrowserFactory.configs[DEFAULT_CONFIG_TAG].options.type).toBe('webkit');
    expect(BrowserFactory.configs[DEFAULT_CONFIG_TAG].options.device).toBe("Blackberry PlayBook");
    await BrowserFactory.closeBrowsers();
  });
  it("missing type", async () => {
    expect(async () => await BrowserFactory.getBrowserFactory(new Logger(LOGGER_NOTHING), ({
      ...browserContextOptions,
      type: 'noodles'
    } as any) as TBrowserFactoryOptions)).rejects.toThrow();
    BrowserFactory.closeBrowsers();
  });
});

describe('browser, context, page', () => {
  it('page, context and browser', async () => {
    const logger = new Logger(LOGGER_NOTHING);
    const bfa = await BrowserFactory.getBrowserFactory(logger, browserContextOptions);
    const test = getDefaultTag(0);
    const test2 = getDefaultTag(1);
    const pa1 = await bfa.getBrowserContextPage(test, 0);
    expect(pa1).toBeDefined();
    expect(Object.keys(BrowserFactory.browsers).length).toBe(1)
    expect(Object.keys(bfa.contexts).length).toBe(1)
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