import { ILogger } from '@haibun/core/build/lib/interfaces/logger';
import { Browser, BrowserContext, Page, chromium, firefox, webkit, BrowserType, devices } from 'playwright';

export const BROWSERS: { [name: string]: BrowserType } = {
  firefox: firefox,
  chromium: chromium,
  webkit: webkit,
};

export class BrowserFactory {
  static browsers: { [name: string]: Browser } = {};
  browser!: Browser;
  static contexts: { [name: string]: BrowserContext } = {};
  pages: { [name: string]: Page } = {};
  logger: ILogger;
  browserType: BrowserType = chromium;
  device: string | undefined = undefined;
  type: string = 'chromium';
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
    this.type = type;
    this.device = device;
  }

  async getBrowser(type: string): Promise<Browser> {
    if (!BrowserFactory.browsers[type]) {
      BrowserFactory.browsers[type] = await this.browserType.launch({ headless: this.headless });
      this.logger.info(`launched new ${type} browser`);
    }
    return BrowserFactory.browsers[type];
  }

  async getContext(ctx: string): Promise<BrowserContext> {
    if (!BrowserFactory.contexts[ctx]) {
      const browser = await this.getBrowser(this.type);
      this.logger.info('creating new context');
      const context = this.device ? { ...devices[this.device] } : {};
      BrowserFactory.contexts[ctx] = await browser.newContext(context);
      // BrowserFactory.contexts[ctx].setDefaultTimeout(900)
    }
    return BrowserFactory.contexts[ctx];
  }

  async closeContext(ctx: string) {
    if (BrowserFactory.contexts[ctx]) {
      await BrowserFactory.contexts[ctx].close();
      delete BrowserFactory.contexts[ctx];
      delete this.pages[ctx]; 
      console.log('xx', ctx);
      
    }
  }

  async closeContexts() {
    for (const c in BrowserFactory.contexts) {
      await this.closeContext(c);
    }
  }

  async getPage(ctx: string): Promise<Page> {
    if ((await this.getContext(ctx)) && this.pages[ctx]) {
      return this.pages[ctx];
    }
    this.logger.info(`creating new page for ${ctx}`);

    const context = await this.getContext(ctx);
    const page = await context.newPage();
    this.pages[ctx] = page;
    return page;
  }
}
