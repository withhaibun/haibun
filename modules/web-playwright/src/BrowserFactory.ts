import { TTag } from '@haibun/core/build/lib/defs';
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

  async getContext(sequence: number): Promise<BrowserContext> {
    if (!this.contexts[sequence]) {
      const browser = await this.getBrowser(this.type);
      this.logger.info(`creating new context ${sequence} ${this.type}`);
      const context = this.device ? { ...devices[this.device] } : {};
      this.contexts[sequence] = await browser.newContext({ ...context, recordVideo: { dir: 'video/' } });
      this.contexts[sequence].setDefaultTimeout(60000)
    }
    return this.contexts[sequence];
  }


  async closeContext({ sequence }: { sequence: number }) {
    if (this.contexts[sequence] !== undefined) {
      let p = this.pages[sequence];
      await p!.close();
    }
    await this.contexts[sequence].close();
    delete this.pages[sequence];
    delete this.contexts[sequence];
  }

  async getPage({ sequence }: { sequence: number }): Promise<Page> {
    if (this.pages[sequence] !== undefined) {
      return this.pages[sequence]!;
    }
    this.logger.info(`\n\ncreating new page for ${sequence}`);

    const context = await this.getContext(sequence);
    const page = await context.newPage();
    this.pages[sequence] = page;
    return page;
  }
}
