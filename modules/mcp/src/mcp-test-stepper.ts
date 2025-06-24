import { AStepper } from '@haibun/core/build/lib/astepper.js';
import { TStepperStep, OK } from '@haibun/core/build/lib/defs.js';

class TestStepper extends AStepper {
	steps: { [name: string]: TStepperStep; } = {
		yourTestPhrasePasses: {
			gwta: 'your test phrase passes',
			action: async () => {
				return Promise.resolve(OK);
			},
		},
		yourTestPhraseFails: {
			gwta: 'your test phrase fails',
			action: async () => {
				return Promise.resolve(OK);
			},
		},
	};
}

export default TestStepper;
