import { Browser, BrowserContext, webkit } from 'playwright';

export class UserAgent {

    browser!: Browser;
    context!: BrowserContext;

    async getBrowser() {
        if (!this.browser) {
            this.browser = await webkit.launch({headless: false});
        }
        return this.browser;
    }

    async getContext() {
        if (!this.context) {
            const browser = await this.getBrowser();
            this.context = await browser.newContext();
        }
        return this.context;
    }
    async getPage(ctx: string = '_') {
        const context = await this.getContext();
        const page = await context.newPage();
        return page;
    }
}
