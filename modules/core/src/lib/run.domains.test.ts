import { onCurrentTypeForDomain, setShared } from '../steps/vars.js';
import { IHasDomains, TNamed, TVStep, IRequireDomains, AStepper } from './defs.js';
import { getDomain } from './domain.js';
import { runWith } from './run.js';
import { asFeatures, getDefaultWorld, testWithDefaults } from './test/lib.js';
import { actionOK, getDefaultOptions } from './util/index.js';

const TTYPE = 'page';
const CCONTROL = 'control';
const ACONTROL = 'lever';

const TestStepsRequiresDomain = class TestStepsRequiresDomain extends AStepper implements IRequireDomains {
  requireDomains = [TTYPE, CCONTROL];
  steps = {
    onType: {
      gwta: `on the {what} {type}$`,
      action: async ({ what, type }: TNamed) => {
        const location = onCurrentTypeForDomain({ name: what, type }, this.getWorld());
        return actionOK(location);
      },
    },
    test: {
      gwta: `See the {what: ${CCONTROL}} ${CCONTROL}`,
      action: async (named: TNamed) => {
        return actionOK();
      },
    },
  };
};

const TestStepsWithDomain = class TestStepsWithDomain extends AStepper implements IHasDomains {
  domains = [
    { name: TTYPE, fileType: TTYPE, is: 'string', validate: () => undefined },
    { name: CCONTROL, from: TTYPE, is: 'string' },
  ];
  locator = (name: string) => `test/${name}`;
  steps = {
    has: {
      gwta: `Has a {what: ${CCONTROL}} control`,
      action: async ({ what }: TNamed, vstep: TVStep) => {
        const value = 'xxx';
        setShared({ what, value }, vstep, this.getWorld());
        return actionOK();
      },
    },
  };
};

describe('domain object', () => {
  it('missing domain object', async () => {
    const result = await testWithDefaults([{ path: '/features/test.feature', content: `\nHas a foobar control\n` }], [TestStepsRequiresDomain]);
    
    expect(result.ok).toBe(false);

    expect(result.failure!.error.message.startsWith(`missing required domain "${TTYPE}"`)).toBe(true);
    expect(result.failure!.error.details.stack).toBeDefined();
  });
  it('domain object from background', async () => {
    const specl = getDefaultOptions();
    const key = '/backgrounds/p1';

    const { world } = getDefaultWorld(0);
    const features = asFeatures([{ path: '/features/test.feature', content: `Backgrounds: p1.${TTYPE}\n\nOn the /backgrounds/p1 ${TTYPE}\nSee the page control\n` }]);
    const backgrounds = asFeatures([{ path: `/backgrounds/p1.${TTYPE}.feature`, content: 'Has a lever control' }]);
    const result = await runWith({ specl, features, backgrounds, addSteppers: [TestStepsRequiresDomain, TestStepsWithDomain], world });

    expect(result.ok).toBe(true);

    expect(world.shared.getCurrent(TTYPE)).toEqual(key);
    const page = getDomain(TTYPE, world)!.shared.get(key);
    expect(page).toBeDefined();
    expect(page.get(ACONTROL)).toEqual('xxx');
  });
});
