import { IHasDomains, AStepper } from '../defs';
import { actionOK } from '../util';


const TestStepsWithDomain = class TestStepsWithDomain extends AStepper implements IHasDomains {
  domains = [{ name: 'door', fileType: 'door', is: 'string', validate: () => undefined }];
  locator = (name: string) => name;
  steps = {
    test: {
      exact: 'The door is open',
      action: async (input: any) => actionOK(),
    },
  };
};


export default TestStepsWithDomain