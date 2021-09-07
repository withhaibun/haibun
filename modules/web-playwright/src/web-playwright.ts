import { Page } from 'playwright';

import { IHasOptions, IStepper, IExtensionConstructor, OK, TWorld, TNamed, TVStep, IRequireDomains } from '@haibun/core/build/lib/defs';
import { onCurrentTypeForDomain } from '@haibun/core/build/steps/vars';
import { BrowserFactory } from './BrowserFactory';
import { actionNotOK, ensureDirectory } from '@haibun/core/build/lib/util';
import { webPage, webControl } from '@haibun/domain-webpage/build/domain-webpage';

declare var window: any;

const WebPlaywright: IExtensionConstructor = class WebPlaywright implements IStepper, IHasOptions, IRequireDomains {
  requireDomains = [webPage, webControl];
  options = {
    STEP_CAPTURE: {
      desc: 'capture screenshot for every step',
      parse: (input: string) => true,
    },
  };
  bf: BrowserFactory;
  world: TWorld;

  constructor(world: TWorld) {
    this.world = world;
    this.bf = new BrowserFactory(world.logger);
  }

  async getPage() {
    if (!this.world.runtime.page) {
      this.world.runtime.page = await this.bf.getPage();
    }
    return this.world.runtime.page;
  }

  async withPage(f: any) {
    const page = await this.getPage();
    return await f(page);
  }

  setBrowser(browser: string) {
    try {
      this.bf.setBrowserType(browser);
      return OK;
    } catch (e: any) {
      return actionNotOK(e.message);
    }
  }

  close() {
    this.bf.browser?.close();
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
        let textContent: string | null;
        for (let a = 0; a < 2; a++) {
          textContent = await this.withPage(async (page: Page) => await page.textContent('body', { timeout: 1e9 }));
          if (textContent?.toString().includes(text)) {
            return OK;
          }
        }
        return actionNotOK(`Did not find text in ${textContent!?.length} characters starting with ${textContent!?.trim().substr(0, 1e9)}`);
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
        const location = onCurrentTypeForDomain({ name, type: webPage }, this.world);

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
      action: async ({ browser }: TNamed) => this.setBrowser(browser),
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

export type TWebPlaywright = {
  bf: BrowserFactory;
};
