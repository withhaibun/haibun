import { IHasOptions, AStepper } from '../defs.js';
import { EExecutionMessageType } from '../interfaces/logger.js';
import { actionOK, getStepperOption } from '../util/index.js';

export const TestStepsWithOptions = class TestStepsWithOptions extends AStepper implements IHasOptions {
	options = {
		EXISTS: {
			desc: 'option exists',
			parse: () => ({ result: 42 }),
		},
	};
	steps = {
		test: {
			exact: 'have a stepper option',
			action: async () => {
				const res = getStepperOption(this, 'EXISTS', this.getWorld().moduleOptions);
				return Promise.resolve(actionOK({ incident: EExecutionMessageType.ACTION, incidentDetails: { summary: 'options', details: res } }));
			},
		},
	};
};

export default TestStepsWithOptions;
