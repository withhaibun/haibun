import { DEFAULT_DEST, IHasOptions, STAY_ALWAYS, STAY_FAILURE, TOptions } from '@haibun/core/build/lib/defs.js';
import { LOGGER_LEVELS } from '@haibun/core/build/lib/Logger.js';
import { boolOrError, intOrError, optionOrError, stringOrError } from '@haibun/core/build/lib/util/index.js';

export class BaseOptions implements IHasOptions {
	static options = {
		KEY: {
			desc: 'execution key (defaults to serialtime)',
			parse: (input: string) => stringOrError(input),
		},
		TRACE: {
			desc: 'save tracks data',
			parse: (input: string) => boolOrError(input),
		},
		DESCRIPTION: {
			desc: 'description for reports',
			parse: (result: string) => ({ result }),
		},
		CLI: {
			desc: 'create a command interface for each member',
			parse: (input: string) => boolOrError(input),
		},
		SETTING: {
			desc: 'execution setting (eg dev, prod)',
			parse: (result: string) => ({ result }),
		},
		DEST: {
			desc: 'destination for captures',
			parse: (result: string) => ({ result }),
		},
		STAY: {
			desc: `stay running after execution: ${STAY_ALWAYS}, ${STAY_FAILURE}`,
			parse: (result: string) => optionOrError(result, [STAY_ALWAYS, STAY_FAILURE]),
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
			desc: 'pass an environment variable: var=value[,var2=value]',
			parse: (input: string, cur: TOptions) => {
				const pairs = input?.split(',');
				const env: TOptions = { ...cur };
				for (const pair of pairs) {
					const [k, v] = pair.split('=').map((i) => i.trim());
					if (cur[k] || env[k]) {
						return { error: `ENV ${k} already defined` };
					}
					env[k] = v;
				}
				return { env };
			},
		},
		ENVC: {
			desc: 'pass multiple environment variables: var1=a,var2=b',
			parse: (input: string, cur: TOptions) => {
				const env: TOptions = { ...cur };

				for (const pair of (input || '').split(',')) {
					const [k, v] = pair.split('=');
					if (env[k]) {
						return { error: `ENVC ${k} already exists` };
					}
					env[k] = v;
				}
				return { env };
			},
		},
		STEP_DELAY: {
			desc: 'delay between steps',
			parse: (input: string) => intOrError(input),
		},
		OUTPUT: {
			desc: 'Output format (AsXUnit)',
			parse: (result: string) => ({ result }),
		},
		OUTPUT_DEST: {
			desc: 'Output destination (results.xml)',
			parse: (result: string) => ({ result }),
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
