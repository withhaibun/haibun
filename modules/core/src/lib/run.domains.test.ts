import { setShared } from '../steps/vars';
import { IExtensionConstructor, IStepper, IHasDomains, TWorld, TNamed, TVStep } from './defs';
import { run } from './run';
import { getOptionsOrDefault, getDefaultWorld, actionOK } from './util';

const TTYPE = 'page';
const CCONTROL = 'control';
const ACONTROL = 'lever';

const TestStepsWithDomain: IExtensionConstructor = class TestStepsWithDomain implements IStepper, IHasDomains {
  world: TWorld;
  domains = [
    { name: TTYPE, fileType: TTYPE, is: 'string', validate: () => undefined },
    { name: CCONTROL, from: TTYPE, is: 'string' },
  ];
  constructor(world: TWorld) {
    this.world = world;
  }
  steps = {
    has: {
      gwta: 'Has a {what} control',
      action: async ({ what }: TNamed, vstep: TVStep) => {
        const value = 'xxx';
        setShared({ what, value }, vstep, this.world);
        return actionOK();
      },
    },
    test: {
      gwta: 'Pull the {what: control}',
      action: async (named: TNamed) => {
        
        return actionOK();
      },
    },
  };
};

describe('domain object from background', () => {
  it('domain object', async () => {
    const base = process.cwd() + '/test/projects/domains/domain-object-from-background';
    const specl = getOptionsOrDefault(base);

    const world = { ...getDefaultWorld().world };
    const { result } = await run({ specl, base, addSteppers: [TestStepsWithDomain], world });

    !result.ok && console.log(JSON.stringify({result, world}, null, 2))
    expect(result.ok).toBe(true);
    const key = '/backgrounds/p1';

    const page = world.domains.find((d) => d.name === TTYPE)!.shared.get(key);
    expect(page).toBeDefined();
    expect(world.shared.getCurrent(TTYPE)).toEqual(key);

    expect(page.get(ACONTROL)).toEqual('xxx');
    // expect(page.get('test')).toEqual('foo');
  });
});
