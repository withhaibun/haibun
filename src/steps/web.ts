import { IStepper, IStepperConstructor, notOk, ok, TLogger, TResult, TRuntime, TShared } from '../lib/defs';
import { BrowserFactory } from '../BrowserFactory';
import { Page } from 'playwright';

type TStepWithPage = {
  match?: any;
  exact?: any;
  action?: any;
  withPage?: (page: Page, vars: any) => Promise<TResult>;
};

const Web: IStepperConstructor = class Web implements IStepper {
  shared: TShared;
  logger: TLogger;
  bf: BrowserFactory;
  runtime: TRuntime;

  constructor(shared: TShared, runtime: TRuntime, logger: TLogger) {
    this.shared = shared;
    this.logger = logger;
    this.runtime = runtime;
    this.bf = new BrowserFactory(logger);
    const preSteps: { [name: string]: TStepWithPage } = {
      usingChrome: {
        exact: `Given I'm using Chrome browser`,
        action: async () => {
          return ok;
        },
      },
      openPage: {
        match: /^When I open the (?<name>.+) page$/,
        withPage: async (page: Page, { name }: { name: string }) => {
          const uri = this.shared[name];
          return (await page.goto(uri)) ? ok : notOk;
        },
      },
      beOnPage: {
        match: /^Then I should be on the (?<name>.+) page$/,
        withPage: async (page: Page, { name }: { name: string }) => {
          const uri = this.shared[name];
          return (await page.url()) === uri ? ok : notOk;
        },
      },
      pressBack: {
        match: /^When I press the back button$/,
        withPage: async (page: Page) => {
          await page.goBack();
          return ok;
        },
      },
      clickOn: {
        match: /^When I click on (?<name>.[^\s]+)$/,
        withPage: async (page: Page, { name }: { name: string }) => {
          const what = this.shared[name] || `text=${name}`;
          await page.click(what);
          return ok;
        },
      },
      URIContains: {
        match: /^Then the URI should include (?<what>.+)$/,
        withPage: async (page: Page, { what }: { what: string }) => ((await page.url().includes(what)) ? ok : notOk),
      },
      URIStartsWith: {
        match: /^Then the URI should start with (?<start>.+)$/,
        withPage: async (page: Page, { start }: { start: string }) => ((await page.url().startsWith(start)) ? ok : notOk),
      },
      URIMatches: {
        match: /^Then the URI should match (?<what>.+)$/,
        withPage: async (page: Page, { what }: { what: string }) => ((await page.url()) === what ? ok : notOk),
      },
      openURL: {
        match: /^When I open the URI (?<uri>.+)$/,
        withPage: async (page: Page, { uri }: { uri: string }) => ((await page.goto(uri)) ? ok : notOk),
      },
      assertOpen: {
        match: /^When the (?<what>.+) is expanded with the (?<using>.+)$/,
        withPage: async (page: Page, { what, using }: { what: string; using: string }) => {
          const v = this.shared[what];
          const u = this.shared[using];
          const isVisible = await page.isVisible(v);
          if (!isVisible) {
            await page.click(u);
          }
          return ok;
        },
      },

      clickCheckbox: {
        match: /^When I click the checkbox (?<name>.+)$/,
        withPage: async (page: Page, { name }: { name: string }) => {
          const what = this.shared[name] || name;
          this.logger.log(`click ${name} ${what}`);
          await page.click(what);
          return ok;
        },
      },
      clickShared: {
        match: /^When I click `(?<id>.+)`$/,
        withPage: async (page: Page, { id }: { id: string }) => {
          const name = this.shared[id];
          await page.click(name);
          return ok;
        },
      },
      clickQuoted: {
        match: /^When I click "(?<name>.+)"$/,
        withPage: async (page: Page, { name }: { name: string }) => {
          await page.click(`text=${name}`);
          return ok;
        },
      },
      clickLink: {
        match: /^When I click on the link (?<uri>.+)$/,
        withPage: async (page: Page, { name }: { name: string }) => {
          const field = this.shared[name] || name;
          await page.click(field);
          return ok;
        },
      },

      clickButton: {
        match: /^When I click on the button (?<id>.+)$/,
        withPage: async (page: Page, { id }: { id: string }) => {
          const field = this.shared[id] || id;
          const a = await page.click(field);

          return ok;
        },
      },

      textContent: {
        match: /Then the element (?<text>.+) is displayed$/,
        withPage: async (page: Page, { id }: { id: string }) => {
          const what = this.shared[id] || id;
          return (await page.textContent(what)) ? ok : notOk;
        },
      },

      pauseSeconds: {
        match: /^And I pause for (?<text>.+)s$/,
        action: async ({ ms }: { ms: string }) => {
          const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

          const seconds = parseInt(ms, 10) * 1000;
          await sleep(seconds);
          return ok;
        },
      },
      inputVariable: {
        match: /^And I set the inputfield "(?<field>.+)" to <(?<what>.+)>$/,
        withPage: async (page: Page, { field, what }: { field: string; what: string }) => {
          const where = this.shared[field] || field;
          const val = this.shared[what] || what;
          await page.fill(where, val);
          return ok;
        },
      },
      seeText: {
        match: /^Then I should see "(?<text>.+)"$/,
        withPage: async (page: Page, { text }: { text: string }) => {
          let textContent: string | null;
          for (let a = 0; a < 2; a++) {
            textContent = await page.textContent('body', { timeout: 1e9 });
            if (textContent?.toString().includes(text)) {
              return ok;
            }
          }
          return { ...notOk, details: `Did not find text in ${textContent!?.length} characters starting with ${textContent!?.trim().substr(0, 1e9)}` };
        },
      },
      input: {
        match: /^And I set the inputfield "(?<field>.+)" to "(?<what>.+)"$/,
        withPage: async (page: Page, { field, what }: { field: string; what: string }) => {
          field = field.replace(/"/g, '');
          const where = this.shared[field];
          await page.fill(where, what);
          return ok;
        },
      },
      selectionOption: {
        match: /^When I select the option "(?<option>.+)" for `(?<id>.+)`$/,
        withPage: async (page: Page, { option, id }: { option: string; id: string }) => {
          const what = this.shared[id] || id;

          const res = await page.selectOption(what, { label: option });
          // FIXME have to use id value
          // return res === [id] ? ok : {...notOk, details: { message: `received ${res} selecting from ${what} with id ${id}`}};
          return ok;
        },
      },
    };
    const steps = Object.entries(preSteps).reduce((a, [p, step]) => {
      const stepper = step as any;
      if (!stepper.withPage) {
        return { ...a, [p]: step };
      }
      (step as any).action = async (input: any) => {
        try {
          return await this.pageRes((step as any).withPage, input, p);
        } catch (e) {
          logger.log(e);
          return { ...notOk };
        }
      };
      return { ...a, [p]: step };
    }, {});

    this.steps = steps;
  }

  async pageRes(method: any, input: any, p: string) {
    const page = await this.bf.getPage();

    this.runtime.page = page;
    const res = await method(page, input);
    return res;
  }

  close() {
    this.bf.browser?.close();
  }

  steps = {};
};
export default Web;
