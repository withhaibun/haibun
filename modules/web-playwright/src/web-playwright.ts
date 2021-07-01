import { Page } from "playwright";

import {
  IHasOptions,
  IStepper,
  IExtensionConstructor,
  OK,
  TResult,
  TWorld,
  TStep,
} from "@haibun/core/build/lib/defs";
import { BrowserFactory } from "./BrowserFactory";
import {
  actionNotOK,
  sleep,
  ensureDirectory,
} from "@haibun/core/build/lib/util";
declare var window: any;

type TStepWithPage = {
  gwta: string;
  action?: any;
  withPage?: (page: Page, vars: any) => Promise<TResult>;
};

const WebPlaywright: IExtensionConstructor = class WebPlaywright
  implements IStepper, IHasOptions
{
  options = {
    STEP_CAPTURE: {
      desc: "capture screenshot for every step",
      parse: (input: string) => true,
    },
  };
  bf: BrowserFactory;
  world: TWorld;

  constructor(world: TWorld) {
    this.world = world;
    this.bf = new BrowserFactory(world.logger);
    const preSteps: { [name: string]: TStepWithPage } = {
      //                                      INPUT
      inputVariable: {
        gwta: "input {what} for {field}",
        withPage: async (
          page: Page,
          { what, field }: { what: string; field: string }
        ) => {
          console.log("\n\nFF", field, what);

          await page.fill(field, what);
          return OK;
        },
      },
      selectionOption: {
        gwta: "select {option} for {field}",
        withPage: async (
          page: Page,
          { option, field }: { option: string; field: string }
        ) => {
          const res = await page.selectOption(field, { label: option });
          // FIXME have to use id value
          // return res === [id] ? ok : {...notOk, details: { message: `received ${res} selecting from ${what} with id ${id}`}};
          return OK;
        },
      },

      //                ASSERTIONS
      seeText: {
        gwta: "should see {text}",
        withPage: async (page: Page, { text }: { text: string }) => {
          let textContent: string | null;
          for (let a = 0; a < 2; a++) {
            textContent = await page.textContent("body", { timeout: 1e9 });
            if (textContent?.toString().includes(text)) {
              return OK;
            }
          }
          return actionNotOK(
            `Did not find text in ${
              textContent!?.length
            } characters starting with ${textContent!?.trim().substr(0, 1e9)}`
          );
        },
      },

      beOnPage: {
        gwta: "should be on the {name} page",
        withPage: async (page: Page, { name }: { name: string }) => {
          let nowon;
          nowon = await page.url();
          if (nowon === name) {
            return OK;
          }
          return actionNotOK(`expected ${name} but on ${nowon}`);
        },
      },
      URIContains: {
        gwta: "URI should include {what}",
        withPage: async (page: Page, { what }: { what: string }) => {
          const uri = await page.url();
          return uri.includes(what)
            ? OK
            : actionNotOK(`current URI ${uri} does not contain ${what}`);
        },
      },
      URIStartsWith: {
        gwta: "URI should start with {start}",
        withPage: async (page: Page, { start }: { start: string }) => {
          const uri = await page.url();
          return uri.startsWith(start)
            ? OK
            : actionNotOK(`current URI ${uri} does not start with ${start}`);
        },
      },
      URIMatches: {
        gwta: "URI should match {what}",
        withPage: async (page: Page, { what }: { what: string }) => {
          const uri = await page.url();
          return uri === what
            ? OK
            : actionNotOK(`current URI ${uri} does not match ${what}`);
        },
      },

      //                  CLICK

      clickOn: {
        gwta: "click on (?<name>.[^s]+)",
        withPage: async (page: Page, { name }: { name: string }) => {
          const what = this.world.shared[name] || `text=${name}`;
          await page.click(what);
          return OK;
        },
      },
      clickCheckbox: {
        gwta: "click the checkbox (?<name>.+)",
        withPage: async (page: Page, { name }: { name: string }) => {
          const what = this.world.shared[name] || name;
          this.world.logger.log(`click ${name} ${what}`);
          await page.click(what);
          return OK;
        },
      },
      clickShared: {
        gwta: "click `(?<id>.+)`",
        withPage: async (page: Page, { id }: { id: string }) => {
          const name = this.world.shared[id];
          await page.click(name);
          return OK;
        },
      },
      clickQuoted: {
        gwta: 'click "(?<name>.+)"',
        withPage: async (page: Page, { name }: { name: string }) => {
          await page.click(`text=${name}`);
          return OK;
        },
      },
      clickLink: {
        gwta: "click the link (?<uri>.+)",
        withPage: async (page: Page, { name }: { name: string }) => {
          const field = this.world.shared[name] || name;
          await page.click(field);
          return OK;
        },
      },

      clickButton: {
        gwta: "click the button (?<id>.+)",
        withPage: async (page: Page, { id }: { id: string }) => {
          const field = this.world.shared[id] || id;
          const a = await page.click(field);

          return OK;
        },
      },

      //                          NAVIGATION
      openPage: {
        gwta: "open the {name} page",
        withPage: async (page: Page, { name }: { name: string }) => {
          const response = await page.goto(name);
          return response?.ok ? OK : actionNotOK(`response not ok`);
        },
      },
      goBack: {
        gwta: "go back",
        withPage: async (page: Page) => {
          await page.goBack();
          return OK;
        },
      },

      pressBack: {
        gwta: "press the back button",
        withPage: async (page: Page) => {
          // FIXME
          await page.evaluate(() => {
            console.log("going back", window.history);
            (window as any).history.go(-1);
          });
          await page.evaluate(() => {
            console.log("went back", window.history);
          });

          // await page.focus('body');
          // await page.keyboard.press('Alt+ArrowRight');
          return OK;
        },
      },

      //                          BROWSER
      usingBrowser: {
        gwta: "using (?<browser>[^`].+[^`]) browser",
        action: async ({ browser }: { browser: string }) =>
          this.setBrowser(browser),
      },
      usingBrowserVar: {
        gwta: "using {browser} browser",
        action: async ({ browser }: { browser: string }) => {
          return this.setBrowser(browser);
        },
      },

      //                          MISC
      takeScreenshot: {
        gwta: "take a screenshot",
        withPage: async (page: Page) => {
          const folder = [process.cwd(), "files"].join("/");
          await ensureDirectory(folder, "screenshots");
          await page.screenshot({
            path: `${folder}/screenshots/screenshot-${Date.now()}.png`,
          });
          return OK;
        },
      },
      assertOpen: {
        gwta: "{what} is expanded with the {using}",
        withPage: async (
          page: Page,
          { what, using }: { what: string; using: string }
        ) => {
          const isVisible = await page.isVisible(what);
          if (!isVisible) {
            await page.click(using);
          }
          return OK;
        },
      },
      pauseSeconds: {
        gwta: "pause for {ms}s",
        action: async ({ ms }: { ms: string }) => {
          const seconds = parseInt(ms, 10) * 1000;
          await sleep(seconds);
          return OK;
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
        } catch (e: any) {
          world.logger.log(e);
          return actionNotOK(e.message, e);
        }
      };
      return { ...a, [p]: step };
    }, {});

    this.steps = steps;
  }

  async pageRes(method: any, input: any, p: string) {
    const page = await this.bf.getPage();

    this.world.runtime.page = page;
    const res = await method(page, input);
    return res;
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

  steps = {};
};
export default WebPlaywright;
