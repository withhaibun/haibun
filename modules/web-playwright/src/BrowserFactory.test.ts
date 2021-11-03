import { Page, webkit } from "playwright";
import Logger, { LOGGER_NONE } from "@haibun/core/build/lib/Logger";
import { BrowserFactory, PageInstance } from "./BrowserFactory";

describe("types", () => {
  it("gets type and device", () => {
    const bf = new BrowserFactory(new Logger(LOGGER_NONE), true);
    bf.setBrowserType("webkit.Blackberry PlayBook");
    expect(bf.browserType).toBe(webkit);
    expect(bf.device).toBe("Blackberry PlayBook");
  });
  it("missing type", () => {
    const bf = new BrowserFactory(new Logger(LOGGER_NONE), true);
    expect(() => bf.setBrowserType("amazingnothing")).toThrowError();
  });
});

describe('browser, context, page', () => {
  it('page, context and browser', async () => {
    const logger = new Logger(LOGGER_NONE);
    const bfa = new BrowserFactory(logger, true);
    const pa1 = await bfa.getPage('test');
    expect(pa1).toBeDefined();
    expect(Object.keys(BrowserFactory.browsers).length).toBe(1)
    expect(Object.keys(bfa.contexts).length).toBe(1)

    const pa2 = await bfa.getPage('test2');
    expect(pa2).toBeDefined();
    expect(Object.keys(BrowserFactory.browsers).length).toBe(1)
    expect(Object.keys(bfa.contexts).length).toBe(2)
    expect((pa1 as PageInstance)._guid).not.toEqual((pa2 as PageInstance)._guid);

    let pa3 = await bfa.getPage('test2');
    expect(pa3).toBeDefined();
    expect(Object.keys(BrowserFactory.browsers).length).toBe(1)
    expect(Object.keys(bfa.contexts).length).toBe(2)
    expect((pa2 as PageInstance)._guid).toEqual((pa3 as PageInstance)._guid);

    const bfb = new BrowserFactory(logger, true);
    const pb1 = await bfb.getPage('also');
    expect(Object.keys(BrowserFactory.browsers).length).toBe(1)
    expect(Object.keys(bfb.contexts).length).toBe(1)
    
    expect(Object.keys(bfa.contexts).length).toBe(2)

    await bfa.closeContext('test2');

    expect(Object.keys(bfa.contexts).length).toBe(1)
    expect(bfa.pages['test2']).toBeUndefined();
  });

});