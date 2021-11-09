import { ILogger, TTraceTopic } from '@haibun/core/build/lib/interfaces/logger';
import { Browser, BrowserContext, Page, chromium, firefox, webkit, BrowserType, devices, Request, Response } from 'playwright';

export const BROWSERS: { [name: string]: BrowserType } = {
  firefox: firefox,
  chromium: chromium,
  webkit: webkit,
};

export type TBrowserFactoryContextOptions = {
  recordVideo?: {
    dir: string
  }
}

export type TBrowserFactoryOptions = {
  browser?: {
    headless?: boolean,
  },
  defaultTimeout?: number
}

export type PageInstance = Page & { _guid: string };

export class BrowserFactory {
  static browser = chromium.launch({ headless: process.env['HAIBUN_O_WEBPLAYWRIGHT_HEADLESS'] !== 'false' });
  static browsers: { [name: string]: Browser } = {};
  contexts: { [name: string]: BrowserContext } = {};
  pages: { [name: string]: Page | undefined } = {};
  logger: ILogger;
  browserType: BrowserType = chromium;
  device: string | undefined = undefined;
  type: string = 'chromium';
  options: TBrowserFactoryOptions;
  myBrowsers: { [name: string]: Browser; };

  private constructor(browsers: { [name: string]: Browser }, logger: ILogger, options: TBrowserFactoryOptions = {}) {
    this.myBrowsers = browsers;
    this.logger = logger;
    this.options = options;
  }

  static get(logger: ILogger, options: TBrowserFactoryOptions = {}) {
    if (!BrowserFactory.browsers) {
      BrowserFactory.browsers = {};

    }
    return new BrowserFactory(BrowserFactory.browsers, logger, options);

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
    return BrowserFactory.browser;
    /*
    if (!BrowserFactory.browsers[type]) {
      BrowserFactory.browsers[type] = await this.browserType.launch(this.options.browser);
      this.logger.info(`launched new ${type} browser`);
    }
    return BrowserFactory.browsers[type];
    */
  }

  getExistingContext({ sequence }: { sequence: number }) {
    if (this.contexts[sequence]) {
      return this.contexts[sequence];
    }
  }

  async getContext(sequence: number, options: TBrowserFactoryContextOptions): Promise<BrowserContext> {
    if (!this.contexts[sequence]) {
      const browser = await this.getBrowser(this.type);
      this.logger.info(`creating new context ${sequence} ${this.type}`);
      const context = this.device ? { ...devices[this.device] } : {};
      this.contexts[sequence] = await browser.newContext({ ...context, ...options });
      if (this.options.defaultTimeout) {
        this.contexts[sequence].setDefaultTimeout(this.options.defaultTimeout)
      }
    }
    return this.contexts[sequence];
  }


  async closeContext({ sequence }: { sequence: number }) {
    if (this.contexts[sequence] !== undefined) {
      let p = this.pages[sequence];
      await p && p?.close();
    }
    await this.contexts[sequence]?.close();
    delete this.pages[sequence];
    delete this.contexts[sequence];
  }

  async close() {
    Object.values(BrowserFactory.browsers).forEach(async (v) => {
      await v.close();
    });
  }

  hasPage({ sequence }: { sequence: number }) {
    return !!this.pages[sequence]
  }

  async getPage({ sequence }: { sequence: number }, options: { trace?: boolean, browser: TBrowserFactoryContextOptions } = { browser: {} }): Promise<Page> {
    const { trace, browser } = options;
    if (this.pages[sequence] !== undefined) {
      return this.pages[sequence]!;
    }
    this.logger.info(`creating new page for ${sequence}`);

    const context = await this.getContext(sequence, browser);
    const page = await context.newPage();

    if (trace) {
      page.on('response', async (res: Response) => {
        const headers = await res.headersArray();
        this.logger.log(`response trace ${Object.keys(headers)}`, { topic: ({ trace: { response: { headers } } } as TTraceTopic) });
      });
    }
    this.pages[sequence] = page;
    return page;
  }
}
