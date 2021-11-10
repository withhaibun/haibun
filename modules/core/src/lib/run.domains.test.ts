import { onCurrentTypeForDomain, setShared } from '../steps/vars';
import { IExtensionConstructor, IStepper, IHasDomains, TWorld, TNamed, TVStep, IRequireDomains } from './defs';
import { getDomain } from './domain';
import { runWith } from './run';
import { asFeatures, getDefaultWorld, testWithDefaults } from './test/lib';
import { getOptionsOrDefault, actionOK } from './util';

const TTYPE = 'page';
const CCONTROL = 'control';
const ACONTROL = 'lever';

const TestStepsRequiresDomain: IExtensionConstructor = class TestStepsRequiresDomain implements IStepper, IRequireDomains {
  world: TWorld;
  requireDomains = [TTYPE, CCONTROL];
  constructor(world: TWorld) {
    this.world = world;
  }
  steps = {
    onType: {
      gwta: `on the {what} {type}$`,
      action: async ({ what, type }: TNamed) => {
        const location = onCurrentTypeForDomain({ name: what, type }, this.world);
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

const TestStepsWithDomain: IExtensionConstructor = class TestStepsWithDomain implements IStepper, IHasDomains {
  world: TWorld;
  domains = [
    { name: TTYPE, fileType: TTYPE, is: 'string', validate: () => undefined },
    { name: CCONTROL, from: TTYPE, is: 'string' },
  ];
  locator = (name: string) => `test/${name}`;
  constructor(world: TWorld) {
    this.world = world;
  }
  steps = {
    has: {
      gwta: `Has a {what: ${CCONTROL}} control`,
      action: async ({ what }: TNamed, vstep: TVStep) => {
        const value = 'xxx';
        setShared({ what, value }, vstep, this.world);
        return actionOK();
      },
    },
  };
};

describe('domain object', () => {
  it('missing domain object', async () => {
    const { result } = await testWithDefaults([{ path: '/features/test.feature', content: `\nHas a foobar control\n` }], [TestStepsRequiresDomain]);
    expect(result.ok).toBe(false);
    
    expect(result.failure!.error.message.startsWith(`missing required domain "${TTYPE}"`)).toBe(true);
    expect(result.failure!.error.details.stack).toBeDefined();
  });
  it('domain object from background', async () => {
    const specl = getOptionsOrDefault();
    const key = '/backgrounds/p1';

    const { world } = getDefaultWorld(0);
    const features = asFeatures([{ path: '/features/test.feature', content: `Backgrounds: p1.${TTYPE}\n\nOn the /backgrounds/p1 ${TTYPE}\nSee the page control\n` }]);
    const backgrounds = asFeatures([{ path: `/backgrounds/p1.${TTYPE}.feature`, content: 'Has a lever control' }]);
    const { result } = await runWith({ specl, features, backgrounds, addSteppers: [TestStepsRequiresDomain, TestStepsWithDomain], world });

    expect(result.ok).toBe(true);

    expect(world.shared.getCurrent(TTYPE)).toEqual(key);
    const page = getDomain(TTYPE, world)!.shared.get(key);
    expect(page).toBeDefined();
    expect(page.get(ACONTROL)).toEqual('xxx');
  });
});
