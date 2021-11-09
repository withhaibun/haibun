import { IStepper, IExtensionConstructor, TWorld, IHasDomains } from '../defs';
import { actionOK } from '../util';


const TestStepsWithDomain: IExtensionConstructor = class TestStepsWithDomain implements IStepper, IHasDomains {
  world: TWorld;
  domains = [{ name: 'door', fileType: 'door', is: 'string', validate: () => undefined }];
  locator = (name: string) => name;
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


export default TestStepsWithDomain