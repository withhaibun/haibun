import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { TLogger } from './lib/defs';

export class BrowserFactory {
  browser!: Browser;
  context!: BrowserContext;
  pages: { [name: string]: Page } = {};
  logger: any;

  constructor(logger: TLogger) {
    this.logger = logger;
  }

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.logger.info('launching new browser');

      this.browser = await chromium.launch({ headless: false });
    }
    return this.browser;
  }

  async getContext(): Promise<BrowserContext> {
    if (!this.context) {
      const browser = await this.getBrowser();
      this.logger.info('creating new context');
      this.context = await browser.newContext();
    }
    return this.context;
  }
  async getPage(ctx: string = '_'): Promise<Page> {
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
