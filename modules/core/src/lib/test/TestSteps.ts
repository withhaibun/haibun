
import { TStepArgs } from '../defs.js';
import { AStepper } from '../astepper.js';
import { actionNotOK, actionOK } from '../util/index.js';

const TestSteps = class TestSteps extends AStepper {
	steps = {
		fails: {
			gwta: 'fails',
			action: async () => Promise.resolve(actionNotOK('test fail')),
		},
		test: {
			exact: 'have a test',
			action: async () => Promise.resolve(actionOK()),
		},
		passes: {
			exact: 'passes',
			action: async () => Promise.resolve(actionOK()),
		},
		throws: {
			gwta: 'throw an exception',
			action: () => {
				throw Error(`<Thrown for test case>`);
			},
		},
	};
};

export default TestSteps;


