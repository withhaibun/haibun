
import { Browser, BrowserContext, Page, chromium, firefox, webkit, BrowserType, devices } from 'playwright';

import { ILogger, } from '@haibun/core/build/lib/interfaces/logger.js';
import { TTagValue, TTraceOptions } from '@haibun/core/build/lib/defs.js';

export const BROWSERS: { [name: string]: BrowserType } = {
  firefox,
  chromium,
  webkit,
};

export type TBrowserFactoryOptions = {
  browser: {
    headless: boolean,
    devtools?: boolean,
    args?: string[]
  },
  recordVideo?: {
    dir: string
  }
  defaultTimeout?: number,
  persistentDirectory?: boolean,
  trace?: TTraceOptions,
  type?: string,
  device?: string
}

export const DEFAULT_CONFIG_TAG = '_default';

export type PageInstance = Page & { _guid: string };

export class BrowserFactory {
  static browsers: { [name: string]: Browser } = {};
  contexts: { [name: string]: BrowserContext } = {};
  pages: { [name: string]: Page | undefined } = {};
  logger: ILogger;
  static configs: {
    [name: string]: {
      options: TBrowserFactoryOptions,
      browserType: BrowserType
    }
  } = {};
  myBrowsers: { [name: string]: Browser; };

  private constructor(logger: ILogger) {
    this.logger = logger;
  }

  static async getBrowserFactory(logger: ILogger, options: TBrowserFactoryOptions, tag = DEFAULT_CONFIG_TAG) {
    options.type = options.type || 'chromium';
    options.device = options.device || '';

    if (!BROWSERS[options.type]) {
      throw Error(`browserType not recognized ${options.type}`);
    }
    BrowserFactory.configs[tag] = { options, browserType: BROWSERS[options.type] };
    return new BrowserFactory(logger);
  }

  async getBrowser(type: string, tag = DEFAULT_CONFIG_TAG): Promise<Browser> {
    if (!BrowserFactory.browsers[type]) {
      BrowserFactory.browsers[type] = await BrowserFactory.configs[tag].browserType
        .launch(BrowserFactory.configs[tag].options.browser);
      this.logger.info(`launched new ${type} browser`);
    }
    return BrowserFactory.browsers[type];
  }

  getExistingContext({ sequence }: { sequence: TTagValue }) {
    if (this.contexts[sequence]) {
      return this.contexts[sequence];
    }
  }

  async getBrowserContext(sequence: TTagValue, tag = DEFAULT_CONFIG_TAG): Promise<BrowserContext> {
    if (!this.contexts[sequence]) {
      let context: BrowserContext;
      if (BrowserFactory.configs.persistentDirectory) {
        this.logger.info(`creating new persistent context ${sequence} ${BrowserFactory.configs[tag].options.type}, ${BrowserFactory.configs.persistentDirectory} with ${JSON.stringify(BrowserFactory.configs)}`);
        context = await BrowserFactory.configs[tag].browserType.launchPersistentContext("", BrowserFactory.configs[tag].options);
      } else {
        this.logger.info(`creating new context ${sequence} ${BrowserFactory.configs[tag].options.type}`);
        const browser = await this.getBrowser(BrowserFactory.configs[tag].options.type);
        const deviceContext = BrowserFactory.configs[tag].options.device ? { ...devices[BrowserFactory.configs[tag].options.device] } : {};
        context = await browser.newContext({ ...deviceContext, ...BrowserFactory.configs[tag].options });
      }
      this.contexts[sequence] = context;
      if (BrowserFactory.configs.defaultTimeout) {
        this.contexts[sequence].setDefaultTimeout(BrowserFactory.configs[tag].options.defaultTimeout)
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

  static async closeBrowsers() {
    for (const b in BrowserFactory.browsers) {
      await BrowserFactory.browsers[b].close();
    };
  }
  async close() {
    await BrowserFactory.closeBrowsers();
  }

  tt(sequence: number, tab?: number) {
    return `${sequence}${tab ? `-${tab}` : ''}`;
  }

  hasPage({ sequence }: { sequence: TTagValue }, tab?: number) {
    return !!this.pages[this.tt(sequence, tab)]
  }

  async getBrowserContextPage({ sequence }: { sequence: TTagValue }, tab?: number): Promise<Page> {
    const { trace } = BrowserFactory.configs;
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
