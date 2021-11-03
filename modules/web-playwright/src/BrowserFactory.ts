import { ILogger } from '@haibun/core/build/lib/interfaces/logger';
import { Browser, BrowserContext, Page, chromium, firefox, webkit, BrowserType, devices, } from 'playwright';

export const BROWSERS: { [name: string]: BrowserType } = {
  firefox: firefox,
  chromium: chromium,
  webkit: webkit,
};

export type PageInstance = Page & { _guid: string };

export class BrowserFactory {
  static browsers: { [name: string]: Browser } = {};
  browser!: Browser;
  contexts: { [name: string]: BrowserContext } = {};
  pages: { [name: string]: Page | undefined } = {};
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
    if (!this.contexts[ctx]) {
      const browser = await this.getBrowser(this.type);
      this.logger.info(`creating new context ${ctx} ${this.type}`);
      const context = this.device ? { ...devices[this.device] } : {};
      this.contexts[ctx] = await browser.newContext({ ...context, recordVideo: { dir: 'video/' } });
      this.contexts[ctx].setDefaultTimeout(60000)
    }
    return this.contexts[ctx];
  }


  async closeContext(ctx: string) {
    if (this.contexts[ctx] !== undefined) {
      let p = this.pages[ctx];
      await p!.close();
    }
    await this.contexts[ctx].close();
    delete this.pages[ctx];
    delete this.contexts[ctx];
  }

  async getPage(ctx: string): Promise<Page> {
    if (this.pages[ctx] !== undefined) {
      return this.pages[ctx]!;
    }
    this.logger.info(`\n\ncreating new page for ${ctx}`);

    const context = await this.getContext(ctx);
    const page = await context.newPage();
    this.pages[ctx] = page;
    return page;
  }
}
