import { Browser, BrowserContext, Page, chromium } from 'playwright';

export class BrowserFactory {
  browser!: Browser;
  context!: BrowserContext;
  pages: { [name: string]: Page } = {};

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      console.log('\nlaunching new browser');

      this.browser = await chromium.launch({ headless: false });
    }
    return this.browser;
  }

  async getContext(): Promise<BrowserContext> {
    if (!this.context) {
      const browser = await this.getBrowser();
      console.log('\ncreating new context');
      this.context = await browser.newContext();
    }
    return this.context;
  }
  async getPage(ctx: string = '_'): Promise<Page> {
    if (this.pages[ctx]) {
      return this.pages[ctx];
    }
    console.log(`\ncreating new page for ${ctx}`);
    
    const context = await this.getContext();
    const page = await context.newPage();
    this.pages[ctx] = page;
    return page;
  }
}