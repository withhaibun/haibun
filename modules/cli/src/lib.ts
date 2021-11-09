import { IHasOptions, TSpecl, } from "@haibun/core/build/lib/defs";
import { getDefaultWorld } from "@haibun/core/build/lib/test/lib";
import { getSteppers, getPre } from "@haibun/core/build/lib/util";
import { TRunResult } from "./cli";

const BASE_VARS: { [name: string]: { desc: string } } = {
    HAIBUN_OUTPUT: { desc: 'Output format (AsXUnit)' },
    HAIBUN_CLI: { desc: 'start a cli for each instance' },
    HAIBUN_LOG_LEVEL: { desc: 'log level (debug, log, info, warn, error, none)' },
    HAIBUN_SPLIT_SHARED: { desc: 'Use vars for split instances (=ex=1,2,3)' },
    PWDEBUG: { desc: '(web) Enable Playwright debugging (0 or 1)' },
    HAIBUN_STEP_DELAY: { desc: 'ms to wait between every step' },
    HAIBUN_STAY: { desc: 'ok or error' }
};

export async function usageThenExit(specl: TSpecl, message?: string) {
    const output = await usage(specl, message);
    console[message ? 'error' : 'info'](output);
    process.exit(message ? 1 : 0);
};

export async function usage(specl: TSpecl, message?: string) {
    let steppers = await getSteppers({ steppers: specl.steppers, world: getDefaultWorld(0).world });
    let a: { [name: string]: { desc: string } } = {};
    steppers.forEach(s => {
        const o = (s as IHasOptions);
        if (o.options) {
            const p = getPre(s);
            a = { ...a, ...Object.keys(o.options).reduce((a, i) => ({ ...a, [`${p}${i}`]: o.options![i] }), {}) };
        }
    });

    const ret = [
        '',
        `usage: ${process.argv[1]} <project base>`,
        message || '',
        'Set these environmental variables to control options:\n',
        ...Object.entries(BASE_VARS).map(([k, v]) => `${k.padEnd(55)} ${v.desc}`),
    ];
    if (Object.keys(a).length) {
        ret.push('\nThese variables are available for selected extensions (via config.js)\n',
            ...Object.entries(a).map(([k, v]) => `${k.padEnd(55)} ${v.desc}`));
    }
    return [...ret, ''].join('\n');
}

export function ranResultError(ranResults: TRunResult[], exceptionResults: any[]): any {
    return JSON.stringify(
        {
            ran: ranResults
                .filter((r) => !r.result.ok)
                .map((r) => ({ stage: r.result.failure?.stage, details: r.result.failure?.error.details, results: r.result.results?.find((r) => r.stepResults.find((r) => !r.ok)) })),
            exceptionResults,
        },
        null,
        2
    );
}
