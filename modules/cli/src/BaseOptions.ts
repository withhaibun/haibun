import { DEFAULT_DEST, IHasOptions, TOptions } from "@haibun/core/build/lib/defs";
import { boolOrError, intOrError } from "@haibun/core/build/lib/util";

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
            desc: 'save trace data',
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
            desc: 'debug, warn, info, log, error, none',
            parse: (result: string) => ({ result })
        },
        ENV: {
            desc: 'pass an environment variable: var=value',
            parse: (input: string, cur: TOptions) => {
                const pairs = input?.split(',');
                for (const pair in pairs) {
                    const [k, v] = pair.split(',').map(i => i.trim());
                    if (cur[k]) {
                        return { error: `ENV ${k} already exists` };
                    }
                    return { env: { [k]: v } };
                }
            },
        },
        ENVC: {
            desc: 'pass multiple environment variables: var1=a,var2=b',
            parse: (input: string, cur: TOptions) => {
                const pairs = new Set(input?.split(',').map(a => a.split('=')[0]));
                let env: TOptions = { DEST: DEFAULT_DEST };

                for (const pair of pairs) {
                    const [k] = Array.from(new Set(pair.split('=')));
                    if (cur[k]) {
                        return { error: `ENVC ${k} already exists` };
                    }
                    env[k] = [];
                }
                for (const pair of input?.split(',')) {
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
        PWDEBUG: {
            desc: '(web) Enable Playwright debugging (0 or 1)',
            parse: (input: string) => process.env['PWDEBUG'] = 'true'
        },
    };
}
