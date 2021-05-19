import { IStepper, IStepperConstructor, notOk, ok, TShared } from '../lib/defs';
import { BrowserFactory } from '../BrowserFactory';

const Web: IStepperConstructor = class Web implements IStepper {
  shared: TShared;
  bf = new BrowserFactory();

  constructor(shared: TShared) {
    this.shared = shared;
  }

  close() {
    this.bf.browser?.close();
  }

  steps = {
    usingChrome: {
      exact: `Given I'm using Chrome browser`,
      action: async () => {
        return ok;
      },
    },
    openPage: {
      match: /^When I open the (?<name>.+) page$/g,
      action: async (inx: any) => {
        const {name} = inx;
        
        const uri = this.shared[name];
        console.log('\n\nSHARED', inx, typeof inx, uri, name, this.shared);
        const page = await this.bf.getPage();
        await page.goto(uri);
        return ok;
      },
    },
    clickOn: {
      match: /^When I click on (?<name>.+)$/g,
      action: async ({ name }: { name: string }) => {
        const what = this.shared[name] || `text=${name}`;
        const page = await this.bf.getPage();

        const res = await page.click(what);
        return ok;
      },
    },
    URIStartsWith: {
      match: /^Then the URI should start with (?<start>.+)$/g,
      action: async ({ start }: { start: string }) => {
        const page = await this.bf.getPage();
        const res = await page.url().startsWith(start);
        return res ? ok : notOk;
      },
    },
  };
};
export default Web;
