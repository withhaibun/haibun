import { IHasOptions } from '@haibun/core/build/lib/astepper.js';
import { CONTINUE_AFTER_ERROR, STAY_ALWAYS, STAY_FAILURE, STEP_DELAY, TEnvVariables } from '@haibun/core/build/lib/defs.js';
import { LOGGER_LEVELS } from '@haibun/core/build/lib/Logger.js';
import { boolOrError, intOrError, optionOrError, randomString, stringOrError } from '@haibun/core/build/lib/util/index.js';

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
