import { IStepper, IStepperConstructor, ok, TVars } from "../lib/defs";
import { UserAgent } from '../Browser';
import { Browser } from "playwright";


const Web: IStepperConstructor = class Web implements IStepper {
  vars: TVars;
  constructor(vars: TVars) {
    this.vars = vars;
  }
  context: { browser?: Browser, ua?: UserAgent } = {};
  close() {
    this.context.browser?.close();
  }

  steps = {
    usingChrome: {
      match: "I'm using Chrome browser",
      action: async () => {
        const ua = new UserAgent();
        this.context.ua = ua;
        this.context.browser = ua.browser;
        return ok;
      }
    },
    openPage: {
      match: /^I open the (?<name>.+) page$/g,
      action: async ({ name }: { name: string }) => {
        const uri = this.vars[name];
        const page = await this.context.ua?.getPage();
        await page?.goto(uri)
        return ok;
      }
    },

    /*
    When(/the PowerApps navbar is expanded/, async () => {
      const visible = await tryTo(() => I.seeElement(".dropdown-toggle"));
      // viewing small format
      if (!visible) {
        const toggle = ".navbar-toggle";
        await I.click(toggle);
      }
    });
    
    When(/I click on the (link|checkbox|button) "(.*?)"/, async (type, loc) => {
      const what = SIC.locate(loc);
      I.click(what);
    });
    
    When(/I click on the visible (link|checkbox|button) "(.*?)"/, async (type, loc) => {
      const vis: ElementHandle[] = await I.getElements(loc);
      for (const v of vis) {
        if (await v.isVisible()) {
          v.click();
          break;
        }
      }
    });
    
    Then(/^I should be on the (.*?) page$/, (page) => {
      I.seeInCurrentUrl(SIC.locate(page));
    });
    
    When(/^I choose the (.*?) CSP$/, (csp) => {
      const myCSP = SIC.locate(csp);
    
      if (myCSP === "_local") {
        const local = "http://localhost:8080/Sign%20In.html";
        return I.amOnPage(local);
      }
    
      return I.click(myCSP);
    });
    
    Then("the element {string} is displayed", (what) => {
      I.see(what);
    });
    
    Then(/^the url should contain "?(.*?)"?$/, (what) => {
      I.seeInCurrentUrl(what);
    });
    
    When("I press the back button", () => {
      I.usePlaywrightTo("go back", async ({ browser, context, page }) => {
        await page.goBack({});
      });
    });
    
    Then(/^I should see "(.*?)"/, (what) => {
      I.see(what);
    });
    
    Then(/^I pause for (.*?)s/, (seconds) => {
      I.wait(seconds);
    });
    
    When(/^I have a saved (username|password) <(.*?)>/, async (type, what) => {
      const { envName, val } = await I.getEnv(what);
    
      if (val === undefined) {
        assert.fail(`no such saved ${what} ${envName}`);
      }
    });
    
    When(/^I have a valid random GCKey username <(.*?)>/, (what) => {
      I.generateRandomUsername(what);
    });
    
    When(/^I have a valid random GCKey password <(.*?)>/, (name) => {
      I.generateRandomPassword(name);
    });
    
    When(/^I set the inputfield "(.*?)" to <(.*?)>/, async (field, name) => {
      await I.click(SIC.locate(field));
      await I.type(await I.getReference(name));
    });
    
    When("I select the option with the text {string} for the element {string}", (element, text) => {
      I.selectOption(SIC.locate(text), element);
    });
    
    When("I set the inputfield {string} to {string}", (field, what) => {
      I.fillField(SIC.locate(field), what);
    });
    
    Then("the element {string} contains the text <testuser>", () => {
      pause();
    });
    
    Then("the browser error log should be clear", async () => {
      // WIP
      let logs = await I.grabBrowserLogs();
      return logs.length < 1;
      // logs.forEach(l => console.log(l));
    });
    
    Then(/I should have the cookie "(.*?)"/, (name) => {
      I.seeCookie(name);
    });
    
    When("I open a new tab", () => {
      I.openNewTab();
    });
    
    //Then('I do a pause', () => {
    //  pause();
    //});
    */

  }
}
export default Web;