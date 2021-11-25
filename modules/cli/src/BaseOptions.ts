import { HAIBUN, IHasOptions, TOptions } from "@haibun/core/build/lib/defs";
import { boolOrError, intOrError } from "@haibun/core/build/lib/util";

export class BaseOptions implements IHasOptions {
    static options = {
        SPLIT_SHARED: {
            desc: 'hi',
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
            desc: 'trace',
            parse: (input: string) => boolOrError(input)
        },
        CLI: {
            desc: 'hi',
            parse: (input: string) => boolOrError(input)
        },
        STAY: {
            desc: 'hi',
            parse: (result: string) => ({ result })
        },
        LOG_FOLLOW: {
            desc: 'hi',
            parse: (result: string) => ({ result })
        },
        LOG_LEVEL: {
            desc: 'hi',
            parse: (result: string) => ({ result })
        },
        ENV: {
            desc: 'hi',
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
            desc: 'hi',
            parse: (input: string, cur: TOptions) => {
                const pairs = new Set(input?.split(',').map(a => a.split('=')[0]));
                let env: TOptions = {};

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
            desc: 'hi',
            parse: (input: string) => intOrError(input)
        },

        LOOPS: {
            desc: 'hi',
            parse: (input: string) => intOrError(input)
        },
        LOOP_START: {
            desc: 'hi',
            parse: (input: string) => intOrError(input)
        },
        LOOP_INC: {
            desc: 'hi',
            parse: (input: string) => intOrError(input)
        },
        MEMBERS: {
            desc: 'hi',
            parse: (input: string) => intOrError(input)
        },
        CONTINUE_ON_ERROR_IF_SCORED: {
            desc: 'scoring for continuation',
            parse: (result: string) => ({ result })
        },
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
