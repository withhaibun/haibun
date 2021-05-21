import { IStepper, IStepperConstructor, notOk, ok, TResult, TShared } from '../lib/defs';
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
  bf = new BrowserFactory();

  constructor(shared: TShared) {
    this.shared = shared;
    const preSteps: { [name: string]: TStepWithPage } = {
      usingChrome: {
        exact: `Given I'm using Chrome browser`,
        action: async () => {
          return ok;
        },
      },
      openPage: {
        match: /^When I open the (?<name>.+) page$/g,
        withPage: async (page: Page, { name }: { name: string }) => {
          const uri = this.shared[name];
          return await page.goto(uri) ? ok : notOk;
        },
      },
      clickOn: {
        match: /^When I click on (?<name>.+)$/g,
        withPage: async (page: Page, { name }: { name: string }) => {
          const what = this.shared[name] || `text=${name}`;
          await page.click(what);
          return ok; 
        },
      },
      URIStartsWith: {
        match: /^Then the URI should start with (?<start>.+)$/g,
        withPage: async (page: Page, { start }: { start: string }) => await page.url().startsWith(start) ? ok : notOk,
      },
      /*
      URIMatches: {
        match: /^Then the URI should match (?<what>.+)$/g,
        action: async ({ what }: { what: string }) => await this.pageRes(async (page: Page) => (await page.url()) === what),
      },
      openURL: {
        match: /^I open the url (?<url>.+)$/,
        action: async ({ url }: { url: string }) => {
          return await this.pageRes(async (page: Page) => {
            return await page.goto(url);
          });
        },
      },

      clickCheckbox: {
        match: /I click on the checkbox (?<name>.+)$/,
        action: async ({ name }: { name: string }) => {
          return await this.pageRes(async (page: Page) => {
            return await page.click(name);
          });
        },
      },

      clickLink: {
        match: /^I click on the link (?<url>.+)$/,
        action: async ({ name }: { name: string }) => {
          return await this.pageRes(async (page: Page) => {
            const field = this.shared[name] || name;
            return await page.click(field);
          });
        },
      },

      ClickButton: {
        match: /^I click on the button (?<id>.+)$/,
        action: async ({ id }: { id: string }) => {
          return await this.pageRes(async (page: Page) => {
            const field = this.shared[id] || id;
            page.click(field);
          });
        },
      },
      */

      /*


Then('the element {string} is displayed', (what) => {
  I.see(what);
});

Then(/^the url contains "(.*?)"$/, (what) => {
  I.seeInCurrentUrl(what);
});

Then(/^I should see "(.*?)"/, (what) => {
  I.see(what);
});

Then(/^I pause for (.*?)s/, (seconds) => {
  I.wait(seconds)
});

When(/^I have a valid random GCKey username <(.*?)>/, (what) => {
  I.generateRandomUsername(what);
});

When(/^I have a valid random GCKey password <(.*?)>/, (name) => {
  I.generateRandomPassword(name);
});

When(/^I set the inputfield "(.*?)" to <(.*?)>/, async (field, name) => {
  const val = '' + await I.getRandom(name);
  I.fillField(SIC.locators[field], val);
});

When('I select the option with the text {string} for the element {string}', (element, text) => {
  I.selectOption(SIC.locators[text], element);
});

When('I set the inputfield {string} to {string}', (field, what) => {
  I.fillField(SIC.locators[field], what);
});

Then('the element {string} contains the text <testuser>', () => {
  pause();
});

Then('I pause', () => {
  pause();
});

Then('the browser error log should be clear', async () => {
  // WIP
  let logs = await I.grabBrowserLogs();
  return logs.length < 1;
  // logs.forEach(l => console.log(l));
});

Then(/I should have the cookie "(.*?)"/, (name) => {
  I.seeCookie(name);
});
*/
    };
    const steps = Object.entries(preSteps).reduce((a, [p, step]) => {
      const stepper = step as any;
      if (!stepper.withPage) {
        return { ...a, [p]: step };
      }
      (step as any).action = async (input: any) => await this.pageRes((step as any).withPage, input);
      return { ...a, [p]: step };
    }, {});

    this.steps = steps;
  }

  async pageRes(method: any, input: any) {
    const page = await this.bf.getPage();
    const res = await method(page, input);
    return res ? ok : notOk;
  }

  close() {
    this.bf.browser?.close();
  }

  steps = {};
};
export default Web;
