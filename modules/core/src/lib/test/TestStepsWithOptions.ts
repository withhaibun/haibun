import { IHasOptions } from '../astepper.js';
import { AStepper } from '../astepper.js';
import { EExecutionMessageType, TMessageContext } from '../interfaces/logger.js';
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
				const messageContext: TMessageContext = { incident: EExecutionMessageType.ACTION, incidentDetails: { summary: 'options', details: res } };
				return Promise.resolve(actionOK({ messageContext }));
			},
		},
	};
};

export default TestStepsWithOptions;
