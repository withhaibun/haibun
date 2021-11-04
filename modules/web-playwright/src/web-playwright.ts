import { Page } from 'playwright';

import { IHasOptions, IStepper, IExtensionConstructor, OK, TWorld, TNamed, TVStep, IRequireDomains, TStepResult } from '@haibun/core/build/lib/defs';
import { onCurrentTypeForDomain } from '@haibun/core/build/steps/vars';
import { BrowserFactory, TBrowserFactoryContextOptions } from './BrowserFactory';
import { actionNotOK, ensureDirectory, getCaptureDir, getStepperOption, getIntOrError } from '@haibun/core/build/lib/util';
import { webPage, webControl } from '@haibun/domain-webpage/build/domain-webpage';

declare var window: any;

const WebPlaywright: IExtensionConstructor = class WebPlaywright implements IStepper, IHasOptions, IRequireDomains {
  requireDomains = [webPage, webControl];
  options = {
    HEADLESS: {
      desc: 'run browsers without a window (true or false)',
      parse: (input: string) => input === 'true',
    },
    CAPTURE_VIDEO: {
      desc: 'capture video for every tag',
      parse: (input: string) => true,
    },
    STEP_CAPTURE_SCREENSHOT: {
      desc: 'capture screenshot for every step',
      parse: (input: string) => true,
    },
    TIMEOUT: {
      desc: 'timeout for each step',
      parse: (input: string) => getIntOrError(input),
    },
  };
  hasFactory: boolean = false;
  bf: BrowserFactory | undefined = undefined;
  world: TWorld;
  headless: boolean = false;

  constructor(world: TWorld) {
    this.world = world;
  }

  async getBrowserFactory(): Promise<BrowserFactory> {
    if (!this.hasFactory) {
      const headless = getStepperOption(this, 'HEADLESS', this.world.options);
      const defaultTimeout = getStepperOption(this, 'TIMEOUT', this.world.options);
      this.bf = BrowserFactory.get(this.world.logger, { defaultTimeout, browser: { headless } });
      this.hasFactory = true;
    }
    return this.bf!;
  }

  async getContext() {
    const context = (await this.getBrowserFactory()).getExistingContext(this.world.tag);
    return context;
  }

  async getPage() {
    const trace = this.world.tag.trace;
    const captureVideo = getStepperOption(this, 'CAPTURE_VIDEO', this.world.options);
    const browser: TBrowserFactoryContextOptions = {};
    if (captureVideo)
      browser.recordVideo = {
        dir: getCaptureDir(this.world.tag, 'video')
      }
    const page = await (await this.getBrowserFactory()).getPage(this.world.tag, { trace, browser });
    return page;
  }

  async withPage(f: any) {
    const page = await this.getPage();
    return await f(page);
  }

  async setBrowser(browser: string) {
    try {
      (await this.getBrowserFactory()).setBrowserType(browser);

      return OK;
    } catch (e: any) {
      return actionNotOK(e.message, { topics: { error: e } });
    }
  }

  async onFailure(result: TStepResult) {
    this.world.logger.error(result);

    if (this.bf?.hasPage(this.world.tag)) {
      const page = await this.getPage();
      const path = getCaptureDir(this.world.tag, 'failure', `${result.seq}.png`);

      await page.screenshot({ path, fullPage: true, timeout: 60000 });
    }
  }

  async nextStep() {
    const captureScreenshot = getStepperOption(this, 'STEP_CAPTURE_SCREENSHOT', this.world.options);
    if (captureScreenshot) {
      console.log('captureScreenshot');
    }

  }

  async nextFeature() {
    // close the context, which closes any pages
    if (this.hasFactory) {
      await this.bf!.closeContext(this.world.tag);
      return;
    }
  }
  async close() {
    // close the context, which closes any pages
    if (this.hasFactory) {
      await this.bf!.closeContext(this.world.tag);
      return;
    }
  }

  // FIXME
  async finish() {
    if (this.hasFactory) {
      this.bf?.close();
      this.bf = undefined;
      this.hasFactory = false;
    }
  }

  steps = {
    //                                      INPUT
    inputVariable: {
      gwta: `input {what} for {field: ${webControl}}`,
      action: async ({ what, field }: TNamed) => {
        await this.withPage(async (page: Page) => await page.fill(field, what));
        return OK;
      },
    },
    selectionOption: {
      gwta: `select {option} for {field: ${webControl}}`,
      action: async ({ option, field }: TNamed) => {
        const res = await this.withPage(async (page: Page) => await page.selectOption(field, { label: option }));
        // FIXME have to use id value
        // return res === [id] ? ok : {...notOk, details: { message: `received ${res} selecting from ${what} with id ${id}`}};
        return OK;
      },
    },

    //                ASSERTIONS
    seeText: {
      gwta: 'should see {text}',
      action: async ({ text }: TNamed) => {
        let textContent: string | null = null;
        // FIXME retry sometimes required?
        for (let a = 0; a < 2; a++) {
          textContent = await this.withPage(async (page: Page) => await page.textContent('body', { timeout: 1e9 }));
          if (textContent?.toString().includes(text)) {
            return OK;
          }
        }
        const topics = { textContent: { summary: `in ${textContent?.length} characters`, details: textContent } };
        return actionNotOK('Did not find text', { topics });
      },
    },
    waitFor: {
      gwta: 'wait for {what}',
      action: async ({ what }: TNamed) => {
        const found = await this.withPage(async (page: Page) => await page.waitForSelector(what));
        if (found) {
          return OK;
        }
        return actionNotOK(`Did not find ${what}`);
      },
    },

    beOnPage: {
      gwta: `should be on the {name: ${webPage}} page`,
      action: async ({ name }: TNamed) => {
        const nowon = await this.withPage(async (page: Page) => await page.url());
        if (nowon === name) {
          return OK;
        }
        return actionNotOK(`expected ${name} but on ${nowon}`);
      },
    },
    cookieShouldBe: {
      gwta: 'cookie {name} should be {value}',
      action: async ({ name, value }: TNamed) => {
        const context = await this.getContext();
        const cookies = await context?.cookies();

        const found = cookies?.find(c => c.name === name && c.value === value);
        return found ? OK : actionNotOK(`did not find cookie ${name} with value ${value}`);
      },
    },
    URIContains: {
      gwta: 'URI should include {what}',
      action: async ({ what }: TNamed) => {
        const uri = await this.withPage(async (page: Page) => await page.url());
        return uri.includes(what) ? OK : actionNotOK(`current URI ${uri} does not contain ${what}`);
      },
    },
    URIStartsWith: {
      gwta: 'URI should start with {start}',
      action: async ({ start }: TNamed) => {
        const uri = await this.withPage(async (page: Page) => await page.url());
        return uri.startsWith(start) ? OK : actionNotOK(`current URI ${uri} does not start with ${start}`);
      },
    },
    URIMatches: {
      gwta: 'URI should match {what}',
      action: async ({ what }: TNamed) => {
        const uri = await this.withPage(async (page: Page) => await page.url());
        return uri.match(what) ? OK : actionNotOK(`current URI ${uri} does not match ${what}`);
      },
    },

    //                  CLICK

    clickOn: {
      gwta: 'click on (?<name>.[^s]+)',
      action: async ({ name }: TNamed) => {
        const what = this.world.shared.get(name) || `text=${name}`;
        await this.withPage(async (page: Page) => await page.click(what));
        return OK;
      },
    },
    clickCheckbox: {
      gwta: 'click the checkbox (?<name>.+)',
      action: async ({ name }: TNamed) => {
        const what = this.world.shared.get(name) || name;
        this.world.logger.log(`click ${name} ${what}`);
        await this.withPage(async (page: Page) => await page.click(what));
        return OK;
      },
    },
    clickShared: {
      gwta: 'click `(?<id>.+)`',
      action: async ({ id }: TNamed) => {
        const name = this.world.shared.get(id);
        await this.withPage(async (page: Page) => await page.click(name));
        return OK;
      },
    },
    clickQuoted: {
      gwta: 'click "(?<name>.+)"',
      action: async ({ name }: TNamed) => {
        await this.withPage(async (page: Page) => await page.click(`text=${name}`));
        return OK;
      },
    },
    clickLink: {
      gwta: 'click the link (?<uri>.+)',
      action: async ({ name }: TNamed) => {
        const field = this.world.shared.get(name) || name;
        await this.withPage(async (page: Page) => await page.click(field));
        return OK;
      },
    },

    clickButton: {
      gwta: 'click the button (?<id>.+)',
      action: async ({ id }: TNamed) => {
        const field = this.world.shared.get(id) || id;
        const a = await this.withPage(async (page: Page) => await page.click(field));

        return OK;
      },
    },

    //                          NAVIGATION
    onPage: {
      gwta: `On the {name} ${webPage}`,
      action: async ({ name }: TNamed, vstep: TVStep) => {
        const location = name.includes('://') ? name : onCurrentTypeForDomain({ name, type: webPage }, this.world);

        const response = await this.withPage(async (page: Page) => await page.goto(location));
        return response?.ok ? OK : actionNotOK(`response not ok`);
      },
    },
    goBack: {
      gwta: 'go back',
      action: async () => {
        await this.withPage(async (page: Page) => await page.goBack());
        return OK;
      },
    },

    pressBack: {
      gwta: 'press the back button',
      action: async () => {
        // FIXME
        await this.withPage(
          async (page: Page) =>
            await page.evaluate(() => {
              console.log('going back', window.history);
              (window as any).history.go(-1);
            })
        );
        // await page.focus('body');
        // await page.keyboard.press('Alt+ArrowRight');
        return OK;
      },
    },

    //                          BROWSER
    usingBrowser: {
      gwta: 'using (?<browser>[^`].+[^`]) browser',
      action: async ({ browser }: TNamed) => await this.setBrowser(browser),
    },
    usingBrowserVar: {
      gwta: 'using {browser} browser',
      action: async ({ browser }: TNamed) => {
        return this.setBrowser(browser);
      },
    },

    //                          MISC
    takeScreenshot: {
      gwta: 'take a screenshot',
      action: async () => {
        const folder = [process.cwd(), 'files'].join('/');
        await ensureDirectory(folder, 'screenshots');
        await this.withPage(
          async (page: Page) =>
            await page.screenshot({
              path: `${folder}/screenshots/screenshot-${Date.now()}.png`,
            })
        );
        return OK;
      },
    },
    assertOpen: {
      gwta: '{what} is expanded with the {using}',
      action: async ({ what, using }: TNamed) => {
        const isVisible = await this.withPage(async (page: Page) => await page.isVisible(what));
        if (!isVisible) {
          await this.withPage(async (page: Page) => await page.click(using));
        }
        return OK;
      },
    },
  };
};
export default WebPlaywright;

export type TWebPlaywright = typeof WebPlaywright;
