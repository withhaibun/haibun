import { ENV_VARS } from "@haibun/core/build/lib/ENV_VARS";
import { TRunResult } from "./cli";

export function usageThenExit(message?: string) {
    console.info(
        [
            '',
            `usage: ${process.argv[1]} <project base>`,
            message || '',
            'Set these environmental variables to control options:\n',
            ...Object.entries(ENV_VARS).map(([k, v]) => `${k.padEnd(25)} ${v}`),
            '',
        ].join('\n')
    );
    process.exit(0);
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