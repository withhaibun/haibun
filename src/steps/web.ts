import { IStepper, IStepperConstructor, ok, TVars } from '../lib/defs';
import { UserAgent } from '../Browser';
import { Browser } from 'playwright';

const Web: IStepperConstructor = class Web implements IStepper {
  vars: TVars;
  constructor(vars: TVars) {
    this.vars = vars;
  }
  context: { browser?: Browser; ua?: UserAgent } = {};
  close() {
    this.context.browser?.close();
  }

  steps = {
    usingChrome: {
      match: `Given I'm using Chrome browser`,
      action: async () => {
        const ua = new UserAgent();
        this.context.ua = ua;
        this.context.browser = ua.browser;
        return ok;
      },
    },
    openPage: {
      match: /^When I open the (?<name>.+) page$/g,
      action: async ({ name }: { name: string }) => {
        const uri = this.vars[name];
        const page = await this.context.ua?.getPage();
        await page?.goto(uri);
        return ok;
      },
    },
    clickOn: {
      match: /^When I click on (?<name>.+)$/g,
      action: async ({ name }: { name: string }) => {
        const what = this.vars[name] || `text=${name}`;
        const page = await this.context.ua?.getPage();
        await page?.click(what);
        return ok;
      },
    },

  };
};
export default Web;
