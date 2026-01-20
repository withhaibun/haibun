import { actionNotOK } from '../lib/util/index.js';
import { AStepper } from '../lib/astepper.js';

const Conformance = class Conformance extends AStepper {
	description = 'Check conformance requirements in specs';

	steps = {
		must: {
			match: /(?!\n|. )\b([A-Z].*? must .*?\.)/,
			action: async () => Promise.resolve(actionNotOK('not implemented')),
		},
	};
};

export default Conformance;
