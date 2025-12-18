import { actionNotOK, actionOK } from '../lib/util/index.js';
import { OK } from '../schema/protocol.js';
import { AStepper } from '../lib/astepper.js';

const Parse = class Parse extends AStepper {
	steps = {
		must: {
			match: /(?!\n|. )\b([A-Z].*? must .*?\.)/,
			action: async () => Promise.resolve(actionNotOK('not implemented')),
		},
		fulfills: {
			gwta: 'fulfills: {what}',
			action: async () => {
				return Promise.resolve(actionOK());
			},
		},
		conformance: {
			gwta: `has annotated conformance doc from {where: string}`,
			action: async () => {
				try {
					// await parseMatches({ where: undefined }, this.getWorld().options.base as string, [conformance]);
				} catch (e) {
					return Promise.resolve(actionNotOK(e.message));
				}
				return Promise.resolve(OK);
			},
		},
	};
};

export default Parse;
