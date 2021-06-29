import { Browser, BrowserContext, Page, BrowserType } from "playwright";
import { TLogger } from "@haibun/core/build/lib/defs";
export declare const BROWSERS: {
    [name: string]: BrowserType;
};
export declare class BrowserFactory {
    browser: Browser;
    context: BrowserContext;
    pages: {
        [name: string]: Page;
    };
    logger: TLogger;
    browserType: BrowserType;
    device: string | undefined;
    constructor(logger: TLogger);
    setBrowserType(typeAndDevice: string): void;
    getBrowser(): Promise<Browser>;
    getContext(): Promise<BrowserContext>;
    getPage(ctx?: string): Promise<Page>;
}
//# sourceMappingURL=BrowserFactory.d.ts.map