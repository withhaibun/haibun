import { Page, Response, Download } from 'playwright';

import { IHasOptions, OK, TNamed, IRequireDomains, TStepResult, TTraceOptions, TTrace, AStepper, TWorld, TVStep, TAnyFixme } from '@haibun/core/build/lib/defs.js';
import { onCurrentTypeForDomain } from '@haibun/core/build/steps/vars.js';
import { BrowserFactory, TBrowserFactoryOptions, TBrowserTypes } from './BrowserFactory.js';
import { actionNotOK, getStepperOption, boolOrError, intOrError, stringOrError, findStepperFromOption, sleep } from '@haibun/core/build/lib/util/index.js';
import { WEB_PAGE, WEB_CONTROL } from '@haibun/domain-webpage/build/domain-webpage.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { EMediaTypes } from '@haibun/domain-storage/build/domain-storage.js';

const WebPlaywright = class WebPlaywright extends AStepper implements IHasOptions, IRequireDomains {
  static STORAGE = 'STORAGE';
  static PERSISTENT_DIRECTORY = 'PERSISTENT_DIRECTORY';
  requireDomains = [WEB_PAGE, WEB_CONTROL];
  options = {
    HEADLESS: {
      desc: 'run browsers without a window (true, false)',
      parse: (input: string) => boolOrError(input)
    },
    DEVTOOLS: {
      desc: `show browser devtools (true or false)`,
      parse: (input: string) => boolOrError(input)
    },
    [WebPlaywright.PERSISTENT_DIRECTORY]: {
      desc: 'run browsers with a persistent directory (true or false)',
      parse: (input: string) => boolOrError(input)
    },
    ARGS: {
      desc: 'pass arguments',
      parse: (input: string) => stringOrError(input)
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
    [WebPlaywright.STORAGE]: {
      required: true,
      desc: 'Storage for output',
      parse: (input: string) => stringOrError(input),
    },
  };
  hasFactory = false;
  bf?: BrowserFactory;
  storage?: AStorage;
  factoryOptions?: TBrowserFactoryOptions;
  tab = 0;
  withFrame: string;
  downloaded: string[] = [];

  async setWorld(world: TWorld, steppers: AStepper[]) {
    super.setWorld(world, steppers);
    this.storage = findStepperFromOption(steppers, this, world.extraOptions, WebPlaywright.STORAGE);
    const headless = (getStepperOption(this, 'HEADLESS', world.extraOptions) === 'true') || !!process.env.CI;
    const devtools = getStepperOption(this, 'DEVTOOLS', world.extraOptions) === 'true';
    const args = getStepperOption(this, 'ARGS', world.extraOptions)?.split(';')
    const persistentDirectory = getStepperOption(this, WebPlaywright.PERSISTENT_DIRECTORY, world.extraOptions) === 'true';
    const defaultTimeout = parseInt(getStepperOption(this, 'TIMEOUT', world.extraOptions)) || 30000;
    const captureVideo = getStepperOption(this, 'CAPTURE_VIDEO', world.extraOptions);
    const { trace: doTrace } = world.tag;
    const trace: TTraceOptions | undefined = doTrace ? {
      response: {
        listener: async (res: Response) => {
          const url = res.url();
          const headers = await res.headersArray();
          const headersContent = (await Promise.allSettled(headers)).map(h => (h as PromiseFulfilledResult<{ value: string, name: string }>).value);
          const topic = { trace: { response: { headersContent } } };
          world.logger.debug(`response trace ${headersContent.map(h => h.name)}`, { topic });
          const trace: TTrace = { 'response': { url, since: world.timer.since(), trace: { headersContent } } }
          world.shared.concat('_trace', trace);
        }
      }
    } : undefined;
    let recordVideo;
    if (captureVideo) {
      const loc = { ...world, mediaType: EMediaTypes.video };
      recordVideo = {
        dir: await this.storage.ensureCaptureLocation(loc, 'video'),
      }
    }

    this.factoryOptions = {
      browser: {
        headless,
        args,
        devtools,
      },
      recordVideo,
      defaultTimeout,
      persistentDirectory,
      trace
    }
  }

  async getBrowserFactory(): Promise<BrowserFactory> {
    if (!this.hasFactory) {
      this.bf = await BrowserFactory.getBrowserFactory(this.getWorld().logger, this.factoryOptions);
      this.hasFactory = true;
    }
    return this.bf
  }

  async getContext() {
    const context = (await this.getBrowserFactory()).getExistingContext(this.getWorld().tag);
    return context;
  }

  async getPage() {
    const { tag } = this.getWorld();
    const page = await (await this.getBrowserFactory()).getBrowserContextPage(tag, this.tab);
    page.on('popup', async (popup: Page) => {
      await popup.waitForLoadState();
      // const title = await popup.title();
      this.newTab();

      this.bf.registerPopup(tag, this.tab, popup);
    });
    return page;
  }

  async withPage<TReturn>(f: TAnyFixme): Promise<TReturn> {
    const page = this.withFrame ? (await this.getPage()).frameLocator(this.withFrame) : await this.getPage();
    this.withFrame && console.log('using frame', this.withFrame);
    this.withFrame = undefined;
    return await f(page);
  }

  async onFailure(result: TStepResult) {
    if (this.bf?.hasPage(this.getWorld().tag, this.tab)) {
      const page = await this.getPage();
      const path = await this.storage.getCaptureLocation({ ...this.getWorld(), mediaType: EMediaTypes.image }, 'failure') + `/${result.seq}.png`;

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
      await this.bf?.closeContext(this.getWorld().tag);
      return;
    }
  }
  async close() {
    // close the context, which closes any pages
    if (this.hasFactory) {
      await this.bf?.closeContext(this.getWorld().tag);
    }
    for (const file of this.downloaded) {
      this.getWorld().logger.debug(`removing ${JSON.stringify(file)}`);
      // rmSync(file);
    }
  }

  // FIXME
  async finish() {
    if (this.hasFactory) {
      await this.bf?.close();
      this.bf = undefined;
      this.hasFactory = false;
    }
  }

  steps = {
    //                                      INPUT
    press: {
      gwta: `press {key}`,
      action: async ({ key }: TNamed) => {
        await this.withPage(async (page: Page) => await page.keyboard.press(key));
        return OK;
      }
    },
    type: {
      gwta: `type {text}`,
      action: async ({ text }: TNamed) => {
        await this.withPage(async (page: Page) => await page.keyboard.type(text));
        return OK;
      }
    },
    inputVariable: {
      gwta: `input {what} for {field}`,
      action: async ({ what, field }: TNamed) => {
        await this.withPage(async (page: Page) => await page.locator(field).fill(what));
        return OK;
      },
    },
    selectionOption: {
      gwta: `select {option} for {field: ${WEB_CONTROL}}`,
      action: async ({ option, field }: TNamed) => {
        await this.withPage(async (page: Page) => await page.selectOption(field, { label: option }));
        // FIXME have to use id value
        return OK;
      },
    },

    //                ASSERTIONS
    dialogIs: {
      gwta: 'dialog {what} {type} says {value}',
      action: async ({ what, type, value }: TNamed) => {
        const cur = this.getWorld().shared.get(what)?.[type];

        return cur === value ? OK : actionNotOK(`${what} is ${cur}`)
      },
    },
    dialogIsUnset: {
      gwta: 'dialog {what} {type} not set',
      action: async ({ what, type }: TNamed) => {
        const cur = this.getWorld().shared.get(what)?.[type];
        return !cur ? OK : actionNotOK(`${what} is ${cur}`)
      },
    },
    seeTextIn: {
      gwta: 'in {selector}, see {text}',
      action: async ({ text, selector }: TNamed) => {
        let textContent: string | null = null;
        // FIXME retry sometimes required?
        for (let a = 0; a < 2; a++) {
          textContent = await this.withPage(async (page: Page) => await page.textContent(selector, { timeout: 1e9 }));
          if (textContent?.toString().includes(text)) {
            return OK;
          }
        }
        const topics = { textContent: { summary: `in ${textContent?.length} characters`, details: textContent } };
        return actionNotOK(`Did not find text "${text}" in ${selector}`, { topics });
      },
    },
    seeText: {
      gwta: 'see {text}',
      action: async ({ text }: TNamed) => {
        let textContent: string | null = null;
        // FIXME retry sometimes required?
        for (let a = 0; a < 2; a++) {
          textContent = await this.withPage(async (page: Page) => await page.textContent('body', { timeout: 1e9 }));
          if (textContent?.toString().includes(text)) {
            return OK;
          }
        }
        const topics = { textContent: { summary: `in ${textContent?.length} characters`, textContent, details: textContent } };
        return actionNotOK(`Did not find text "${text}" in document`, { topics });
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

    onNewPage: {
      gwta: `on a new tab`,
      action: async () => {
        this.newTab();
        return OK;
      },
    },
    waitForTabX: {
      gwta: `pause until current tab is {tab}`,
      action: async ({ tab }: TNamed) => {
        const waitForTab = parseInt(tab, 10);
        let timedOut = false;
        setTimeout(() => {
          timedOut = true;
        }, 5000);

        while (this.tab !== waitForTab && !timedOut) {
          await sleep(100);
        }

        return this.tab === waitForTab ? OK : actionNotOK(`current tab is ${this.tab}, not ${waitForTab}`);
      },
    },
    onTabX: {
      gwta: `on tab {tab}`,
      action: async ({ tab }: TNamed) => {
        this.tab = parseInt(tab, 10);
        return OK;
      },
    },
    beOnPage: {
      gwta: `be on the {name} ${WEB_PAGE}`,
      action: async ({ name }: TNamed) => {
        const nowon = await this.withPage(async (page: Page) => await page.url());
        if (nowon === name) {
          return OK;
        }
        return actionNotOK(`expected ${name} but on ${nowon}`);
      },
    },
    extensionContext: {
      gwta: `open extension popup for tab {tab}`,
      action: async ({ tab }: TNamed) => {

        if (!this.factoryOptions?.persistentDirectory || this.factoryOptions?.browser.headless) {
          throw Error(`extensions require ${WebPlaywright.PERSISTENT_DIRECTORY} and not HEADLESS`);
        }
        const context = await this.getContext();
        if (!context) {
          throw Error(`no context`);
        }

        const background = context?.serviceWorkers()[0];

        if (!background) {
          // background = await context.waitForEvent("serviceworker");
        }

        console.log('background', background, context.serviceWorkers())

        const extensionId = background.url().split("/")[2];
        this.getWorld().shared.set('extensionContext', extensionId);
        await this.withPage(async (page: Page) => {
          const popupURI = `chrome-extension://${extensionId}/popup.html?${tab}`;
          return await page.goto(popupURI);
        });

        return OK;
      }
    },
    cookieIs: {
      gwta: 'cookie {name} is {value}',
      action: async ({ name, value }: TNamed) => {
        const context = await this.getContext();
        const cookies = await context?.cookies();

        const found = cookies?.find(c => c.name === name && c.value === value);
        return found ? OK : actionNotOK(`did not find cookie ${name} with value ${value}`);
      },
    },
    URIContains: {
      gwta: 'URI includes {what}',
      action: async ({ what }: TNamed) => {
        const uri = await this.withPage<string>(async (page: Page) => await page.url());
        return uri.includes(what) ? OK : actionNotOK(`current URI ${uri} does not contain ${what}`);
      },
    },
    URIQueryParameterIs: {
      gwta: 'URI query parameter {what} is {value}',
      action: async ({ what, value }: TNamed) => {
        const uri = await this.withPage<string>(async (page: Page) => await page.url());
        const found = new URL(uri).searchParams.get(what);
        if (found === value) {
          return OK;
        }
        return actionNotOK(`URI query ${what} contains "${found}"", not "${value}""`);
      },
    },
    URIStartsWith: {
      gwta: 'URI starts with {start}',
      action: async ({ start }: TNamed) => {
        const uri = await this.withPage<string>(async (page: Page) => await page.url());
        return uri.startsWith(start) ? OK : actionNotOK(`current URI ${uri} does not start with ${start}`);
      },
    },
    URIMatches: {
      gwta: 'URI matches {what}',
      action: async ({ what }: TNamed) => {
        const uri = await this.withPage<string>(async (page: Page) => await page.url());
        return uri.match(what) ? OK : actionNotOK(`current URI ${uri} does not match ${what}`);
      },
    },

    //                  CLICK

    clickByAltText: {
      gwta: 'click by alt text {altText}',
      action: async ({ altText }: TNamed) => {
        await this.withPage(async (page: Page) => await page.getByAltText(altText).click());
        return OK;
      }
    },
    clickByTestId: {
      gwta: 'click by test id {testId}',
      action: async ({ testId }: TNamed) => {
        await this.withPage(async (page: Page) => await page.getByTestId(testId).click());
        return OK;
      }
    },
    clickByPlaceholder: {
      gwta: 'click by placeholder {placeholder}',
      action: async ({ placeholder }: TNamed) => {
        await this.withPage(async (page: Page) => await page.getByPlaceholder(placeholder).click());
        return OK;
      }
    },
    clickByRole: {
      gwta: 'click by role {roleStr}',
      action: async ({ roleStr }: TNamed) => {
        const [role, ...restStr] = roleStr.split(' ');
        let rest;
        try {
          rest = JSON.parse(restStr.join(' '));
        } catch (e) {
          return actionNotOK(`could not parse role ${roleStr} as JSON: ${e}`);
        }
        await this.withPage(async (page: Page) => await page.getByRole(<TAnyFixme>role, rest || {}).click());
        return OK;
      }
    },
    clickByLabel: {
      gwta: 'click by label {label}',
      action: async ({ title: label }: TNamed) => {
        await this.withPage(async (page: Page) => await page.getByLabel(label).click());
        return OK;
      }
    },
    clickByTitle: {
      gwta: 'click by title {title}',
      action: async ({ title }: TNamed) => {
        await this.withPage(async (page: Page) => await page.getByTitle(title).click());

        return OK;
      }
    },
    clickByText: {
      gwta: 'click by text {text}',
      action: async ({ text }: TNamed) => {
        await this.withPage(async (page: Page) => await page.getByText(text).click());
        return OK;
      }
    },
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
      // TODO: generalize modifier
      gwta: 'click( with alt)? the link {name}',
      action: async ({ name }: TNamed, vstep: TVStep) => {
        const modifier = vstep.in.match(/ with alt /) ? { modifiers: ['Alt'] } : {};
        const field = this.getWorld().shared.get(name) || name;
        await this.withPage(async (page: Page) => await page.click(field, <TAnyFixme>modifier));
        return OK;
      },
    },

    clickButton: {
      gwta: 'click the button (?<id>.+)',
      action: async ({ id }: TNamed) => {
        const field = this.getWorld().shared.get(id) || id;
        await this.withPage(async (page: Page) => await page.click(field));

        return OK;
      },
    },

    //                          NAVIGATION

    // formerly On the {name} ${WEB_PAGE}
    onPage: {
      gwta: `go to the {name} ${WEB_PAGE}`,
      action: async ({ name }: TNamed) => {
        const location = name.includes('://') ? name : onCurrentTypeForDomain({ name, type: WEB_PAGE }, this.getWorld());
        const response = await this.withPage<Response>(async (page: Page) => {
          return await page.goto(location);
        });

        return response?.ok ? OK : actionNotOK(`response not ok`, { topics: { response: { ...response.allHeaders, summary: response.statusText() } } });
      },
    },
    reloadPage: {
      gwta: 'reload page',
      action: async () => {
        await this.withPage(async (page: Page) => await page.reload());
        return OK;
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

    //                         BROWSER
    usingBrowserVar: {
      gwta: 'using {browser} browser',
      action: async ({ browser }: TNamed) => {
        return this.setBrowser(browser);
      },
    },

    //  FILE DOWNLOAD/UPLOAD
    uploadFile: {
      gwta: 'upload file {file} using {selector}',
      action: async ({ file, selector }: TNamed) => {
        await this.withPage(async (page: Page) => await page.setInputFiles(selector, file));
        return OK;
      }
    },

    waitForDownload: {
      gwta: 'save download to {file}',
      action: async ({ file }: TNamed) => {
        try {
          const download = <Download>await (this.withPage(async (page: Page) => page.waitForEvent('download')));

          await download.saveAs(file);
          this.downloaded.push(file);
          return OK;
        } catch (e) {
          return actionNotOK(e);
        }
      }
    },


    //                          MISC
    withFrame: {
      gwta: 'with frame {name}',
      action: async ({ name }: TNamed) => {
        this.withFrame = name;
        return OK;
      }
    },
    captureDialog: {
      gwta: 'Accept next dialog to {where}',
      action: async ({ where }: TNamed) => {
        await this.withPage(async (page: Page) => page.on('dialog', async (dialog) => {
          const res = {
            defaultValue: dialog.defaultValue(),
            message: dialog.message(),
            type: dialog.type()
          }
          await dialog.accept();
          this.getWorld().shared.set(where, res);
        }));
        return OK;
      },
    },
    takeScreenshot: {
      gwta: 'take a screenshot',
      action: async () => {
        const loc = { ...this.getWorld(), mediaType: EMediaTypes.image };
        const dir = await this.storage.ensureCaptureLocation(loc, 'screenshots');
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
      gwta: 'save URI query parameter {what} to {where}',
      action: async ({ what, where }: TNamed) => {
        const uri = await this.withPage<string>(async (page: Page) => await page.url());
        const found = new URL(uri).searchParams.get(what);
        this.getWorld().shared.set(where, found);
        return OK;
      },
    },
  };
  setBrowser(browser: string) {
    this.factoryOptions.type = (browser as unknown) as TBrowserTypes;
    return OK;
  }
  newTab() {
    this.tab = this.tab + 1;
  }
};

export default WebPlaywright;

export type TWebPlaywright = typeof WebPlaywright;
