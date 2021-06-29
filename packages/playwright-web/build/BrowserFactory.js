"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserFactory = exports.BROWSERS = void 0;
const playwright_1 = require("playwright");
exports.BROWSERS = {
    firefox: playwright_1.firefox,
    chromium: playwright_1.chromium,
    webkit: playwright_1.webkit,
};
class BrowserFactory {
    constructor(logger) {
        this.pages = {};
        this.browserType = playwright_1.chromium;
        this.device = undefined;
        this.logger = logger;
    }
    setBrowserType(typeAndDevice) {
        const [type, device] = typeAndDevice.split(".");
        if (!exports.BROWSERS[type]) {
            throw Error(`browserType not recognized ${type}`);
        }
        this.browserType = exports.BROWSERS[type];
        this.device = device;
    }
    async getBrowser() {
        if (!this.browser) {
            this.logger.info("launching new browser");
            this.browser = await this.browserType.launch({ headless: false });
        }
        return this.browser;
    }
    async getContext() {
        if (!this.context) {
            const browser = await this.getBrowser();
            this.logger.info("creating new context");
            const context = this.device ? { ...playwright_1.devices[this.device] } : {};
            this.context = await browser.newContext(context);
        }
        return this.context;
    }
    async getPage(ctx = "_DEFAULT_CONTEXT") {
        if (this.pages[ctx]) {
            return this.pages[ctx];
        }
        this.logger.info(`creating new page for ${ctx}`);
        const context = await this.getContext();
        const page = await context.newPage();
        this.pages[ctx] = page;
        return page;
    }
}
exports.BrowserFactory = BrowserFactory;
//# sourceMappingURL=BrowserFactory.js.map