import { Browser, BrowserContext, Page, chromium, firefox, webkit, BrowserType, devices } from 'playwright';
import { TLogger } from '../../lib/defs';

export const BROWSERS: { [name: string]: BrowserType } = {
  firefox: firefox,
  chromium: chromium,
  webkit: webkit,
};

export class BrowserFactory {
  browser!: Browser;
  context!: BrowserContext;
  pages: { [name: string]: Page } = {};
  logger: TLogger;
  browserType: BrowserType = chromium;
  device: string | undefined = undefined;

  constructor(logger: TLogger) {
    this.logger = logger;
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

      this.browser = await this.browserType.launch({ headless: false });
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
