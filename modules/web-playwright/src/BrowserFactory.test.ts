import { webkit } from "playwright";
import Logger, {  LOGGER_NONE } from "@haibun/core/build/lib/Logger";
import { BrowserFactory } from "./BrowserFactory";

describe("BrowserFactory", () => {
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
