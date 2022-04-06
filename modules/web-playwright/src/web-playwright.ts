import { Page, Response } from 'playwright';
import { IHasOptions, OK, TNamed, TVStep, IRequireDomains, TStepResult, TTraceOptions, TTrace, AStepper, TWorld } from '@haibun/core/build/lib/defs';
import { onCurrentTypeForDomain } from '@haibun/core/build/steps/vars';
import { BrowserFactory, TBrowserFactoryContextOptions } from './BrowserFactory';
import { actionNotOK, getStepperOption, boolOrError, intOrError, stringOrError, findStepperFromOption } from '@haibun/core/build/lib/util';
import { WEB_PAGE, WEB_CONTROL } from '@haibun/domain-webpage/build/domain-webpage';
import { TTraceTopic } from '@haibun/core/build/lib/interfaces/logger';
import { AStorage } from '@haibun/domain-storage/build/AStorage';
import { EMediaTypes } from '@haibun/domain-storage';

const STORAGE = 'STORAGE';

const WebPlaywright = class WebPlaywright extends AStepper implements IHasOptions, IRequireDomains {
  requireDomains = [WEB_PAGE, WEB_CONTROL];
  options = {
    HEADLESS: {
      desc: 'run browsers without a window (true or false)',
      parse: (input: string) => boolOrError(input)
    },
    CAPTURE_VIDEO: {
      desc: 'capture video for every agent',
      parse: (input: string) => boolOrError(input),
    },
    STEP_CAPTURE_SCREENSHOT: {
      desc: 'capture screenshot for every step',
      parse: (input: string) => boolOrError(input),
    },
    TIMEOUT: {
      desc: 'timeout for each step',
      parse: (input: string) => intOrError(input),
    },
    [STORAGE]: {
      required: true,
      desc: 'Storage for output',
      parse: (input: string) => stringOrError(input),
    },
  };
  hasFactory: boolean = false;
  bf: BrowserFactory | undefined = undefined;
  headless: boolean = false;
  storage?: AStorage;

  async setWorld(world: TWorld, steppers: AStepper[]) {
    super.setWorld(world, steppers);
    this.storage = findStepperFromOption(steppers, this, this.getWorld().extraOptions, STORAGE);
  }

  async getBrowserFactory(): Promise<BrowserFactory> {
    if (!this.hasFactory) {
      const headless = getStepperOption(this, 'HEADLESS', this.getWorld().extraOptions) === 'true';
      const defaultTimeout = parseInt(getStepperOption(this, 'TIMEOUT', this.getWorld().extraOptions)) || 30000;
      this.bf = BrowserFactory.get(this.getWorld().logger, { defaultTimeout, browser: { headless } });
      this.hasFactory = true;
    }
    return this.bf!;
  }

  async getContext() {
    const context = (await this.getBrowserFactory()).getExistingContext(this.getWorld().tag);
    return context;
  }

  async getPage() {
    const { trace: doTrace } = this.getWorld().tag;
    const captureVideo = getStepperOption(this, 'CAPTURE_VIDEO', this.getWorld().extraOptions);
    const browser: TBrowserFactoryContextOptions = {};
    if (captureVideo) {
      const loc = { ...this.getWorld(), mediaType: EMediaTypes.video };
      browser.recordVideo = {
        dir: await this.storage!.ensureCaptureLocation(loc, 'video'),
      }
    }

    const trace: TTraceOptions | undefined = doTrace ? {
      response: {
        listener: async (res: Response) => {
          const url = res.url();
          const headers = await res.headersArray();
          const headersContent = (await Promise.allSettled(headers)).map(h => (h as any).value);
          this.getWorld().logger.debug(`response trace ${headersContent.map(h => h.name)}`, { topic: ({ trace: { response: { headersContent } } } as TTraceTopic) });
          const trace: TTrace = { 'response': { url, since: this.getWorld().timer.since(), trace: { headersContent } } }
          this.getWorld().shared.concat('_trace', trace);
        }
      }
    } : undefined;
    const page = await (await this.getBrowserFactory()).getPage(this.getWorld().tag, { trace, browser });
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
    this.getWorld().logger.error(result);

    if (this.bf?.hasPage(this.getWorld().tag)) {
      const page = await this.getPage();
      const path = await this.storage!.getCaptureLocation({...this.getWorld(), mediaType: EMediaTypes.image}, 'failure') + `/${result.seq}.png`;

      await page.screenshot({ path, fullPage: true, timeout: 60000 });
    }
  }

  async nextStep() {
    const captureScreenshot = getStepperOption(this, 'STEP_CAPTURE_SCREENSHOT', this.getWorld().extraOptions);
    if (captureScreenshot) {
      console.debug('captureScreenshot');
    }
  }

  async endFeature() {
    // close the context, which closes any pages
    if (this.hasFactory) {
      await this.bf!.closeContext(this.getWorld().tag);
      return;
    }
  }
  async close() {
    // close the context, which closes any pages
    if (this.hasFactory) {
      await this.bf!.closeContext(this.getWorld().tag);
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
      gwta: `input {what} for {field: ${WEB_CONTROL}}`,
      action: async ({ what, field }: TNamed) => {
        await this.withPage(async (page: Page) => await page.fill(field, what));
        return OK;
      },
    },
    selectionOption: {
      gwta: `select {option} for {field: ${WEB_CONTROL}}`,
      action: async ({ option, field }: TNamed) => {
        const res = await this.withPage(async (page: Page) => await page.selectOption(field, { label: option }));
        // FIXME have to use id value
        // return res === [id] ? ok : {...notOk, details: { message: `received ${res} selecting from ${what} with id ${id}`}};
        return OK;
      },
    },

    //                ASSERTIONS
    dialogIs: {
      gwta: 'dialog {what} {type} is {value}',
      action: async ({ what, type, value }: TNamed) => {
        const cur = this.getWorld().shared.get(what)?.[type];

        return cur === value ? OK : actionNotOK(`${what} is ${cur}`)
      },
    },
    dialogIsUnset: {
      gwta: 'dialog {what} {type} not set',
      action: async ({ what, type, value }: TNamed) => {
        const cur = this.getWorld().shared.get(what)?.[type];
        return !cur ? OK : actionNotOK(`${what} is ${cur}`)
      },
    },
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
      gwta: `should be on the {name: ${WEB_PAGE}} page`,
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
    URIQueryParameterIs: {
      gwta: 'URI query parameter {what} is {value}',
      action: async ({ what, value }: TNamed) => {
        const uri = await this.withPage(async (page: Page) => await page.url());
        const found = new URL(uri).searchParams.get(what);
        if (found === value) {
          return OK;
        }
        return actionNotOK(`URI query ${what} contains "${found}"", not "${value}""`);
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
        const what = this.getWorld().shared.get(name) || `text=${name}`;
        await this.withPage(async (page: Page) => await page.click(what));
        return OK;
      },
    },
    clickCheckbox: {
      gwta: 'click the checkbox (?<name>.+)',
      action: async ({ name }: TNamed) => {
        const what = this.getWorld().shared.get(name) || name;
        this.getWorld().logger.log(`click ${name} ${what}`);
        await this.withPage(async (page: Page) => await page.click(what));
        return OK;
      },
    },
    clickShared: {
      gwta: 'click `(?<id>.+)`',
      action: async ({ id }: TNamed) => {
        const name = this.getWorld().shared.get(id);
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
        const field = this.getWorld().shared.get(name) || name;
        await this.withPage(async (page: Page) => await page.click(field));
        return OK;
      },
    },

    clickButton: {
      gwta: 'click the button (?<id>.+)',
      action: async ({ id }: TNamed) => {
        const field = this.getWorld().shared.get(id) || id;
        const a = await this.withPage(async (page: Page) => await page.click(field));

        return OK;
      },
    },

    //                          NAVIGATION
    onPage: {
      gwta: `On the {name} ${WEB_PAGE}`,
      action: async ({ name }: TNamed, vstep: TVStep) => {
        const location = name.includes('://') ? name : onCurrentTypeForDomain({ name, type: WEB_PAGE }, this.getWorld());

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
              console.debug('going back', globalThis.history);
              globalThis.history.go(-1);
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
    captureDialog: {
      gwta: 'Accept next dialog to {where}',
      action: async ({ where }: TNamed) => {
        const a = await this.withPage(async (page: Page) => page.on('dialog', dialog => {
          const res = {
            defaultValue: dialog.defaultValue(),
            message: dialog.message(),
            type: dialog.type()
          }
          dialog.accept();
          this.getWorld().shared.set(where, res);
        }));
        return OK;
      },
    },
    takeScreenshot: {
      gwta: 'take a screenshot',
      action: async () => {
        const loc = { ...this.getWorld(), mediaType: EMediaTypes.image };
        const dir = await this.storage!.ensureCaptureLocation(loc, 'screenshots');
        await this.withPage(
          async (page: Page) =>
            await page.screenshot({
              path: `${dir}/screenshot-${Date.now()}.png`,
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
    setToURIQueryParameter: {
      gwta: 'Save URI query parameter {what} to {where}',
      action: async ({ what, where }: TNamed) => {
        const uri = await this.withPage(async (page: Page) => await page.url());
        const found = new URL(uri).searchParams.get(what);
        this.getWorld().shared.set(where, found!);
        return OK;
      },
    },
  };
};
export default WebPlaywright;

export type TWebPlaywright = typeof WebPlaywright;
