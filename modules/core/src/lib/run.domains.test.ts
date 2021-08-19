import { IExtensionConstructor, IStepper, IHasDomains, TWorld } from './defs';
import { run } from './run';
import { getOptionsOrDefault, getDefaultWorld, actionOK } from './util';

const TTYPE = 'house';

const TestStepsWithDomain: IExtensionConstructor = class TestStepsWithDomain implements IStepper, IHasDomains {
  world: TWorld;
  domains = [
    { name: TTYPE, fileType: TTYPE, is: 'string', validate: () => undefined },
    { name: 'door', from: TTYPE, is: 'string' },
  ];
  constructor(world: TWorld) {
    this.world = world;
  }
  steps = {
    test: {
      exact: 'The door is open',
      action: async (input: any) => actionOK(),
    },
  };
};

describe('domain object from background', () => {
  it('domain object', async () => {
    const base = process.cwd() + '/test/projects/domains/domain-object-from-background';
    const specl = getOptionsOrDefault(base);

    const world = { ...getDefaultWorld().world };
    const { result } = await run({ specl, base, addSteppers: [TestStepsWithDomain], world });

    expect(result.ok).toBe(true);
    expect(world.domains[0].shared.get(TTYPE)).toBeDefined();
    expect(world.domains[0].shared.get(TTYPE).get('door').closed).toEqual('true');
  });
});
