import { IStepper, IStepperConstructor, notOk, TShared } from '../lib/defs';
import { UserAgent } from '../Browser';
import { Browser } from 'playwright';

const Web: IStepperConstructor = class Web implements IStepper {
  shared: TShared;
  constructor(shared: TShared) {
    this.shared = shared;
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
        return notOk;
      },
    },
    openPage: {
      match: /^When I open the (?<name>.+) page$/g,
      action: async ({ name }: { name: string }) => {
        const uri = this.shared[name];
        const page = await this.context.ua?.getPage();
        await page?.goto(uri);
        return notOk;
      },
    },
    clickOn: {
      match: /^When I click on (?<name>.+)$/g,
      action: async ({ name }: { name: string }) => {
        const what = this.shared[name] || `text=${name}`;
        const page = await this.context.ua?.getPage();
        await page?.click(what);
        return notOk;
      },
    },

  };
};
export default Web;
