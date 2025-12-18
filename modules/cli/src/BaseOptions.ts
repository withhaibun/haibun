import { TEnvVariables } from '@haibun/core/lib/defs.js';
import { CONTINUE_AFTER_ERROR, STAY_ALWAYS, STAY_FAILURE, STEP_DELAY } from '@haibun/core/schema/protocol.js';
import { IHasOptions } from '@haibun/core/lib/astepper.js';
import { boolOrError, intOrError, optionOrError, randomString, stringOrError } from '@haibun/core/lib/util/index.js';

const LOGGER_LEVELS = { debug: 0, trace: 1, log: 2, info: 3, warn: 4, error: 5, none: 6 };

export class BaseOptions implements IHasOptions {
	static options = {
		KEY: {
			desc: 'execution key (defaults to serialtime)',
			parse: (input: string) => stringOrError(input),
		},
		DESCRIPTION: {
			desc: 'description for reports',
			parse: (result: string) => ({ result }),
		},
		SETTING: {
			desc: 'execution setting (eg dev, prod)',
			parse: (result: string) => ({ result }),
		},
		STAY: {
			desc: `stay running after execution: ${STAY_ALWAYS}, ${STAY_FAILURE}`,
			parse: (result: string) => optionOrError(result, [STAY_ALWAYS, STAY_FAILURE]),
		},
		[CONTINUE_AFTER_ERROR]: {
			desc: `continue after error`,
			parse: (input: string) => boolOrError(input),
		},
		LOG_FOLLOW: {
			desc: 'filter for output',
			parse: (result: string) => ({ result }),
		},
		LOG_LEVEL: {
			desc: Object.keys(LOGGER_LEVELS).join(', '),
			parse: (result: string) =>
				Object.keys(LOGGER_LEVELS).includes(result)
					? { result }
					: { error: `${result} not in ${Object.keys(LOGGER_LEVELS).join(', ')}` },
		},
		ENV: {
			desc: 'pass variables: var=value[,var2=value]',
			parse: (input: string, cur: TEnvVariables) => {
				const pairs = input?.split(',');
				const env: TEnvVariables = { ...cur };
				for (const pair of pairs) {
					const [k, v] = pair.split('=').map((i) => i.trim());
					if (!k && !v) continue;
					if (!k) throw Error(`No key provided for ENV ${v}`);
					if (cur[k] || env[k]) {
						return { error: `ENV ${k} already defined` };
					}
					if (v.match(/{random}/)) {
						v.replace(/{random}/g, randomString());
					}
					env[k] = v;
				}
				return { env };
			},
		},
		[STEP_DELAY]: {
			desc: 'delay between steps',
			parse: (input: string) => intOrError(input),
		},
		PWDEBUG: {
			desc: '(web) Enable Playwright debugging (0 or 1)',
			parse: (input: string) => {
				if (['true', '1'].includes(input)) {
					process.env['PWDEBUG'] = 'true';
				}
				return { result: input };
			},
		},
	};
}
