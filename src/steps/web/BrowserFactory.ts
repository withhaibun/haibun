import { Browser, BrowserContext, Page, chromium, firefox, webkit, BrowserType } from 'playwright';
import { TLogger } from '../../lib/defs';

type TBrowserType = 'chromium' | 'firefox' | 'webkit';

const BROWSERS = {
  firefox: firefox,
  chromium: chromium,
  webkit: webkit
}

export class BrowserFactory {
  browser!: Browser;
  context!: BrowserContext;
  pages: { [name: string]: Page } = {};
  logger: any;
  browserType: BrowserType = chromium;

  constructor(logger: TLogger) {
    this.logger = logger;
  }

  async setBrowserType(type: TBrowserType) {
    this.browserType = BROWSERS[type];
  }

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.logger.info('launching new browser');

      this.browser = await this.browserType.launch({ headless: false });
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
