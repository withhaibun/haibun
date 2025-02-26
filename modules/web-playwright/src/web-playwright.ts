import { Page, Response, Download } from 'playwright';

import { IHasOptions, OK, TNamed, TStepResult, AStepper, TWorld, TFeatureStep, TAnyFixme } from '@haibun/core/build/lib/defs.js';
import { WEB_PAGE, WEB_CONTROL } from '@haibun/core/build/lib/domain-types.js';
import { BrowserFactory, TBrowserFactoryOptions, TBrowserTypes } from './BrowserFactory.js';
import { actionNotOK, getStepperOption, boolOrError, intOrError, stringOrError, findStepperFromOption, sleep } from '@haibun/core/build/lib/util/index.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { TActionStage, TArtifactMessageContext, TTraceMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';
import Logger from '@haibun/core/build/lib/Logger.js';
import { resolve } from 'path';

const WebPlaywright = class WebPlaywright extends AStepper implements IHasOptions {
  static STORAGE = 'STORAGE';
  static PERSISTENT_DIRECTORY = 'PERSISTENT_DIRECTORY';
  requireDomains = [WEB_PAGE, WEB_CONTROL];
  options = {
    HEADLESS: {
      desc: 'run browsers without a window (true, false)',
      parse: (input: string) => boolOrError(input),
    },
    DEVTOOLS: {
      desc: `show browser devtools (true or false)`,
      parse: (input: string) => boolOrError(input),
    },
    [WebPlaywright.PERSISTENT_DIRECTORY]: {
      desc: 'run browsers with a persistent directory (true or false)',
      parse: (input: string) => boolOrError(input),
    },
    ARGS: {
      desc: 'pass arguments',
      parse: (input: string) => stringOrError(input),
    },
    CAPTURE_VIDEO: {
      desc: 'capture video for every agent',
      parse: (input: string) => boolOrError(input),
      dependsOn: ['STORAGE'],
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
  captureVideo: string;

  async setWorld(world: TWorld, steppers: AStepper[]) {
    await super.setWorld(world, steppers);
    this.storage = findStepperFromOption(steppers, this, world.moduleOptions, WebPlaywright.STORAGE);
    const headless = getStepperOption(this, 'HEADLESS', world.moduleOptions) === 'true' || !!process.env.CI;
    const devtools = getStepperOption(this, 'DEVTOOLS', world.moduleOptions) === 'true';
    const args = [...(getStepperOption(this, 'ARGS', world.moduleOptions)?.split(';') || ''), '--disable-gpu'];
    const persistentDirectory = getStepperOption(this, WebPlaywright.PERSISTENT_DIRECTORY, world.moduleOptions) === 'true';
    const defaultTimeout = parseInt(getStepperOption(this, 'TIMEOUT', world.moduleOptions)) || 30000;
    this.captureVideo = getStepperOption(this, 'CAPTURE_VIDEO', world.moduleOptions);
    let recordVideo;
    if (this.captureVideo) {
      recordVideo = {
        dir: await this.getCaptureDir('video')
      };
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
    };
  }
  async getCaptureDir(type: string) {
    const loc = { ...this.world, mediaType: EMediaTypes.video };
    const dir = await this.storage.ensureCaptureLocation(loc, type);
    return dir;
  }

  async getBrowserFactory(): Promise<BrowserFactory> {
    if (!this.hasFactory) {
      this.bf = await BrowserFactory.getBrowserFactory(this.getWorld().logger, this.factoryOptions);
      this.hasFactory = true;
    }
    return this.bf;
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
    this.withFrame && console.debug('using frame', this.withFrame);
    this.withFrame = undefined;
    return await f(page);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async onFailure(result: TStepResult, step?: TFeatureStep): Promise<void | TTraceMessageContext> {
    if (this.bf?.hasPage(this.getWorld().tag, this.tab)) {
      await this.captureFailureScreenshot('failure', 'onFailure', step);
    }
  }

  // FIXME currently not executed
  async nextStep(step: TFeatureStep) {
    const captureScreenshot = getStepperOption(this, 'STEP_CAPTURE_SCREENSHOT', this.getWorld().moduleOptions);
    if (captureScreenshot) {
      await this.captureRequestScreenshot('request', 'nextStep', step.seq);
    }
  }

  async endFeature() {
    // close the context, which closes any pages
    if (this.hasFactory) {
      if (this.captureVideo) {
        const page = await this.getPage();
        const path = await page.video().path();
        const artifact = { type: 'video', path }
        this.getWorld().logger.info('endFeature video', <TArtifactMessageContext>{ artifact, topic: { event: 'summary', stage: 'endFeature' }, tag: this.getWorld().tag });
      }
      // await this.bf?.closeContext(this.getWorld().tag);
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

  async sees(text: string, selector: string) {
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
  }
  steps = {
    //                                      INPUT
    press: {
      gwta: `press {key}`,
      action: async ({ key }: TNamed) => {
        await this.withPage(async (page: Page) => await page.keyboard.press(key));
        return OK;
      },
    },
    type: {
      gwta: `type {text}`,
      action: async ({ text }: TNamed) => {
        await this.withPage(async (page: Page) => await page.keyboard.type(text));
        return OK;
      },
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

        return cur === value ? OK : actionNotOK(`${what} is ${cur}`);
      },
    },
    dialogIsUnset: {
      gwta: 'dialog {what} {type} not set',
      action: async ({ what, type }: TNamed) => {
        const cur = this.getWorld().shared.get(what)?.[type];
        return !cur ? OK : actionNotOK(`${what} is ${cur}`);
      },
    },
    seeTestId: {
      gwta: 'has test id {testId}',
      action: async ({ testId }: TNamed) => {
        const found = await this.withPage(async (page: Page) => await page.getByTestId(testId));
        return found ? OK : actionNotOK(`Did not find test id ${testId}`);
      },
    },
    seeTextIn: {
      gwta: 'in {selector}, see {text}',
      action: async ({ text, selector }: TNamed) => {
        return await this.sees(text, selector);
      },
    },
    seeText: {
      gwta: 'see {text}',
      action: async ({ text }: TNamed) => {
        return await this.sees(text, 'body');
      },
    },
    waitFor: {
      gwta: 'wait for {what}',
      action: async ({ what }: TNamed) => {
        const selector = what.match(/^[.#]/) ? what : `text=${what}`;
        const found = await this.withPage(async (page: Page) => await page.waitForSelector(selector));
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
        const nowon = await this.withPage(async (page: Page) => {
          await page.waitForURL(name);
          return page.url();
        });
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

        console.debug('background', background, context.serviceWorkers());

        const extensionId = background.url().split('/')[2];
        this.getWorld().shared.set('extensionContext', extensionId);
        await this.withPage(async (page: Page) => {
          const popupURI = `chrome-extension://${extensionId}/popup.html?${tab}`;
          return await page.goto(popupURI);
        });

        return OK;
      },
    },
    cookieIs: {
      gwta: 'cookie {name} is {value}',
      action: async ({ name, value }: TNamed) => {
        const context = await this.getContext();
        const cookies = await context?.cookies();

        const found = cookies?.find((c) => c.name === name && c.value === value);
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
    caseInsensitiveURIMatches: {
      gwta: 'URI case insensitively matches {what}',
      action: async ({ what }: TNamed) => {
        const uri = await this.withPage<string>(async (page: Page) => await page.url());
        const matcher = new RegExp(what, 'i');
        return uri.match(matcher) ? OK : actionNotOK(`current URI ${uri} does not match ${what}`);
      },
    },

    //                  CLICK

    clickByAltText: {
      gwta: 'click by alt text {altText}',
      action: async ({ altText }: TNamed) => {
        await this.withPage(async (page: Page) => await page.getByAltText(altText).click());
        return OK;
      },
    },
    clickByTestId: {
      gwta: 'click by test id {testId}',
      action: async ({ testId }: TNamed) => {
        await this.withPage(async (page: Page) => await page.getByTestId(testId).click());
        return OK;
      },
    },
    clickByPlaceholder: {
      gwta: 'click by placeholder {placeholder}',
      action: async ({ placeholder }: TNamed) => {
        await this.withPage(async (page: Page) => await page.getByPlaceholder(placeholder).click());
        return OK;
      },
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
      },
    },
    clickByLabel: {
      gwta: 'click by label {label}',
      action: async ({ title: label }: TNamed) => {
        await this.withPage(async (page: Page) => await page.getByLabel(label).click());
        return OK;
      },
    },
    clickByTitle: {
      gwta: 'click by title {title}',
      action: async ({ title }: TNamed) => {
        await this.withPage(async (page: Page) => await page.getByTitle(title).click());

        return OK;
      },
    },
    clickByText: {
      gwta: 'click by text {text}',
      action: async ({ text }: TNamed) => {
        await this.withPage(async (page: Page) => await page.getByText(text).click());
        return OK;
      },
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
      action: async ({ name }: TNamed, featureStep: TFeatureStep) => {
        const modifier = featureStep.in.match(/ with alt /) ? { modifiers: ['Alt'] } : {};
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
    gotoPage: {
      gwta: `go to the {name} ${WEB_PAGE}`,
      action: async ({ name }: TNamed) => {
        const response = await this.withPage<Response>(async (page: Page) => {
          return await page.goto(name);
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

    blur: {
      gwta: 'blur {what}',
      action: async ({ what }: TNamed) => {
        await this.withPage(
          async (page: Page) => await page.locator(what).evaluate(e => e.blur())
        );
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
      },
    },

    waitForDownload: {
      gwta: 'save download to {file}',
      action: async ({ file }: TNamed) => {
        try {
          const download = <Download>await this.withPage(async (page: Page) => page.waitForEvent('download'));

          await download.saveAs(file);
          this.downloaded.push(file);
          return OK;
        } catch (e) {
          return actionNotOK(e);
        }
      },
    },

    //                          MISC
    withFrame: {
      gwta: 'with frame {name}',
      action: async ({ name }: TNamed) => {
        this.withFrame = name;
        return OK;
      },
    },
    captureDialog: {
      gwta: 'Accept next dialog to {where}',
      action: async ({ where }: TNamed) => {
        await this.withPage(async (page: Page) =>
          page.on('dialog', async (dialog) => {
            const res = {
              defaultValue: dialog.defaultValue(),
              message: dialog.message(),
              type: dialog.type(),
            };
            await dialog.accept();
            this.getWorld().shared.set(where, res);
          })
        );
        return OK;
      },
    },
    takeScreenshot: {
      gwta: 'take a screenshot',
      action: async (notUsed, featureStep: TFeatureStep) => {
        await this.captureScreenshot('request', 'action', featureStep);
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
    resizeWindow: {
      gwta: 'resize window to {width}x{height}',
      action: async ({ width, height }: TNamed) => {
        await this.withPage(async (page: Page) => await page.setViewportSize({ width: parseInt(width), height: parseInt(height) }));
        return OK;
      },
    },
  };
  setBrowser(browser: string) {
    this.factoryOptions.type = browser as unknown as TBrowserTypes;
    return OK;
  }
  newTab() {
    this.tab = this.tab + 1;
  }
  async captureFailureScreenshot(event: 'failure', stage: TActionStage, step: TFeatureStep) {
    return await this.captureScreenshot(event, stage, { step });
  }
  async captureRequestScreenshot(event: 'request', stage: TActionStage, seq: number) {
    return await this.captureScreenshot(event, stage, { seq });
  }

  async captureScreenshot(event: 'failure' | 'request', stage: TActionStage, details: { seq?: number, step?: TFeatureStep }) {
    const loc = await this.getCaptureDir('image');
    // FIXME shouldn't be fs dependant
    const path = resolve(this.storage.fromLocation(EMediaTypes.image, loc, `${event}-${Date.now()}.png`));
    await this.withPage(
      async (page: Page) =>
        await page.screenshot({
          path,
        })
    );
    const artifact = Logger.logArtifact({ type: 'picture', path });
    const artifactTopic = { topic: { ...details, event, stage }, artifact, tag: this.getWorld().tag };
    this.getWorld().logger.info('screenshot', artifactTopic,);
  }
};

export default WebPlaywright;

export type TWebPlaywright = typeof WebPlaywright;
