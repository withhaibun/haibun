
import { Browser, BrowserContext, Page, chromium, firefox, webkit, BrowserType, devices, } from 'playwright';

import { ILogger, } from '@haibun/core/build/lib/interfaces/logger';
import { TTagValue, TTraceOptions } from '@haibun/core/build/lib/defs';

export const BROWSERS: { [name: string]: BrowserType } = {
  firefox: firefox,
  chromium: chromium,
  webkit: webkit,
};

export type TBrowserFactoryOptions = {
  browser: {
    headless: boolean,
    devtools?: boolean,
    args: string[] | undefined
  },
  recordVideo?: {
    dir: string
  }
  defaultTimeout?: number,
  persistentDirectory?: string,
  trace?: TTraceOptions,
}

export type PageInstance = Page & { _guid: string };

const DEFAULT_BROWSER_OPTIONS = { browser: { headless: true, args: [] } };

export class BrowserFactory {
  static browser?: Browser = undefined;
  static browsers: { [name: string]: Browser } = {};
  contexts: { [name: string]: BrowserContext } = {};
  pages: { [name: string]: Page | undefined } = {};
  logger: ILogger;
  browserType: BrowserType = chromium;
  device: string | undefined = undefined;
  type: string = 'chromium';
  static options: TBrowserFactoryOptions;
  myBrowsers: { [name: string]: Browser; };

  private constructor(browsers: { [name: string]: Browser }, logger: ILogger) {
    this.myBrowsers = browsers;
    this.logger = logger;
  }

  static async getBrowserFactory(logger: ILogger, options: TBrowserFactoryOptions) {
    if (!BrowserFactory.browser) {
      BrowserFactory.options = options;
      BrowserFactory.browser = await chromium.launch(this.options.browser);
    }
    if (!BrowserFactory.browsers) {
      BrowserFactory.browsers = {};
    }
    return new BrowserFactory(BrowserFactory.browsers, logger);
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
    return BrowserFactory.browser!;
    /*
    if (!BrowserFactory.browsers[type]) {
      BrowserFactory.browsers[type] = await this.browserType.launch(this.options.browser);
      this.logger.info(`launched new ${type} browser`);
    }
    return BrowserFactory.browsers[type];
    */
  }

  getExistingContext({ sequence }: { sequence: TTagValue }) {
    if (this.contexts[sequence]) {
      return this.contexts[sequence];
    }
  }

  async getBrowserContext(sequence: TTagValue): Promise<BrowserContext> {
    if (!this.contexts[sequence]) {
      let context: BrowserContext;
      if (BrowserFactory.options.persistentDirectory) {
        console.log('options', BrowserFactory.options);

        this.logger.info(`creating new persistent context ${sequence} ${this.type}, ${BrowserFactory.options.persistentDirectory} with ${JSON.stringify(BrowserFactory.options)}`);
        context = await chromium.launchPersistentContext("", BrowserFactory.options.browser);
      } else {
        this.logger.info(`creating new context ${sequence} ${this.type}`);
        const browser = await this.getBrowser(this.type);
        const deviceContext = this.device ? { ...devices[this.device] } : {};
        context = await browser.newContext({ ...deviceContext, ...BrowserFactory.options });
      }
      this.contexts[sequence] = context;
      if (BrowserFactory.options.defaultTimeout) {
        this.contexts[sequence].setDefaultTimeout(BrowserFactory.options.defaultTimeout)
      }
    }
    return this.contexts[sequence];
  }


  async closeContext({ sequence }: { sequence: TTagValue }) {
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

  tt(sequence: number, tab?: number) {
    return `${sequence}${tab ? `-${tab}` : ''}`;
  }

  hasPage({ sequence }: { sequence: TTagValue }, tab?: number) {
    return !!this.pages[this.tt(sequence, tab)]
  }

  async getBrowserContextPage({ sequence }: { sequence: TTagValue }, tab?: number): Promise<Page> {
    const { trace } = BrowserFactory.options;
    const tt = this.tt(sequence, tab);
    let page = this.pages[tt];
    if (page) {
      return page;
    }
    this.logger.info(`creating new page for ${sequence}`);

    const context = await this.getBrowserContext(sequence);
    page = await context.newPage();

    if (trace) {
      Object.keys(trace).forEach(t => {
        // FIXME
        (page as any).on(t, trace[t].listener);
      })
    }
    this.pages[tt] = page;
    return page;
  }
}
