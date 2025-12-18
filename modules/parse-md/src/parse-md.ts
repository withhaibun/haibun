import { OK } from '@haibun/core/schema/protocol.js';
import { actionNotOK } from '@haibun/core/lib/util/index.js';
import { parseMatches } from './parse.js';
import { AStepper } from '@haibun/core/lib/astepper.js';

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
