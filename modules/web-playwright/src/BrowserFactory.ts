import { ILogger } from '@haibun/core/build/lib/interfaces/logger';
import { Browser, BrowserContext, Page, chromium, firefox, webkit, BrowserType, devices } from 'playwright';

export const BROWSERS: { [name: string]: BrowserType } = {
  firefox: firefox,
  chromium: chromium,
  webkit: webkit,
};

export class BrowserFactory {
  browser!: Browser;
  context!: BrowserContext;
  pages: { [name: string]: Page } = {};
  logger: ILogger;
  browserType: BrowserType = chromium;
  device: string | undefined = undefined;
  headless: boolean = false;

  constructor(logger: ILogger, headless: boolean) {
    this.logger = logger;
    this.headless = headless;
  }

  setBrowserType(typeAndDevice: string) {
    const [type, device] = typeAndDevice.split('.');
    if (!BROWSERS[type]) {
      throw Error(`browserType not recognized ${type}`);
    }
    this.browserType = BROWSERS[type];
    this.device = device;
  }

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.logger.info('launching new browser');

      this.browser = await this.browserType.launch({ headless: this.headless });
    }
    return this.browser;
  }

  async getContext(): Promise<BrowserContext> {
    if (!this.context) {
      const browser = await this.getBrowser();
      this.logger.info('creating new context');
      const context = this.device ? { ...devices[this.device] } : {};
      this.context = await browser.newContext(context);
    }
    return this.context;
  }
  async getPage(ctx: string = '_DEFAULT_CONTEXT'): Promise<Page> {
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
