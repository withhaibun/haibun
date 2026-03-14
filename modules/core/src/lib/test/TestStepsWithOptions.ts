import { IHasOptions } from '../astepper.js';
import { AStepper } from '../astepper.js';
import { actionOKWithProducts, getStepperOption } from '../util/index.js';
import { z } from 'zod';

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
			outputSchema: z.object({ summary: z.string() }),
			action: () => {
				const _res = getStepperOption(this, 'EXISTS', this.getWorld().moduleOptions);
				return Promise.resolve(actionOKWithProducts({ summary: 'options' }));
			},
		},
	};
};

export default TestStepsWithOptions;
