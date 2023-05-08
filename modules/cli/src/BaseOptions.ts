import { DEFAULT_DEST, IHasOptions, TOptions } from "@haibun/core/build/lib/defs.js";
import { LOGGER_LEVELS } from "@haibun/core/build/lib/Logger.js";
import { boolOrError, intOrError } from "@haibun/core/build/lib/util/index.js";
export class BaseOptions implements IHasOptions {
    static options = {
        SPLIT_SHARED: {
            desc: 'create instances based on variable options, for example, var=option1,option2',
            parse: (input: string) => {
                const [what, s] = input.split('=');

                if (!what || !s) {
                    return { error: `var=option1,option2` };
                } else {
                    return { result: s.split(',').map((w: string) => ({ [what]: w })) };
                }
            }
        },
        TRACE: {
            desc: 'save tracks data',
            parse: (input: string) => boolOrError(input)
        },
        TITLE: {
            desc: 'title for reports',
            parse: (result: string) => ({ result })
        },
        CLI: {
            desc: 'create a command interface for each member',
            parse: (input: string) => boolOrError(input)
        },
        SETTING: {
            desc: 'execution setting (eg dev, prod)',
            parse: (result: string) => ({ result })
        },
        DEST: {
            desc: 'destination for captures',
            parse: (result: string) => ({ result })
        },
        STAY: {
            desc: 'stay running after execution: always',
            parse: (result: string) => ({ result })
        },
        LOG_FOLLOW: {
            desc: 'filter for output',
            parse: (result: string) => ({ result })
        },
        LOG_LEVEL: {
            desc: Object.keys(LOGGER_LEVELS).join(', '),
            parse: (result: string) => Object.keys(LOGGER_LEVELS).includes(result) ? { result } : { error: `${result} not in ${Object.keys(LOGGER_LEVELS).join(', ')}` }
        },
        ENV: {
            desc: 'pass an environment variable: var=value[,var2=value]',
            parse: (input: string, cur: TOptions) => {
                const pairs = input?.split(',');
                const env: { [name: string]: string } = {};
                for (const pair of pairs) {
                    const [k, v] = pair.split('=').map(i => i.trim());
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
                const pairs = new Set(input?.split(',').map(a => a.split('=')[0]));
                const env: TOptions = { DEST: DEFAULT_DEST };

                for (const pair of pairs) {
                    const [k] = Array.from(new Set(pair.split('=')));
                    if (cur[k]) {
                        return { error: `ENVC ${k} already exists` };
                    }
                    env[k] = [];
                }
                for (const pair of (input || '').split(',')) {
                    const [k, v] = pair.split('=');
                    env[k].push(v);
                }
                return { env };
            }
        },
        STEP_DELAY: {
            desc: 'delay between steps',
            parse: (input: string) => intOrError(input)
        },

        LOOPS: {
            desc: 'how many loops',
            parse: (input: string) => intOrError(input)
        },
        // LOOP_START: {
        //     desc: 'wip',
        //     parse: (input: string) => intOrError(input)
        // },
        // LOOP_INC: {
        //     desc: 'wip',
        //     parse: (input: string) => intOrError(input)
        // },
        MEMBERS: {
            desc: 'number of members in each loop',
            parse: (input: string) => intOrError(input)
        },
        // CONTINUE_ON_ERROR_IF_SCORED: {
        //     desc: 'wip',
        //     parse: (result: string) => ({ result })
        // },
        OUTPUT: {
            desc: 'Output format (AsXUnit)',
            parse: (result: string) => ({ result })
        },
        OUTPUT_DEST: {
            desc: 'Output destination (results.xml)',
            parse: (result: string) => ({ result })
        },
        PWDEBUG: {
            desc: '(web) Enable Playwright debugging (0 or 1)',
            parse: (input: string) => {
                if (['true', '1'].includes(input)) {
                    process.env['PWDEBUG'] = 'true';
                }
                return { result: input };
            }
        },
    };
}
