import { OK, AStepper } from '@haibun/core/build/lib/defs.js';
import { actionNotOK } from '@haibun/core/build/lib/util/index.js';
import { parseMatches } from './parse.js';

const conformance = /(?!\n|. )\b([A-Z].*? must .*?\.)/;

const ParseMD = class ParseMD extends AStepper {
	steps = {
		conformance: {
			gwta: `has annotated conformance doc from {where: string}`,
			action: async () => {
				try {
					for (const base of this.getWorld().bases) {
						await parseMatches({ where: undefined }, base, [conformance]);
					}
				} catch (e) {
					return actionNotOK(e.message);
				}
				return OK;
			},
		},
	};
};

export default ParseMD;
