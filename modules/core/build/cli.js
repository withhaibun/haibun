#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const repl_1 = __importDefault(require("repl"));
const ENV_VARS_1 = require("./lib/ENV_VARS");
const Logger_1 = __importDefault(require("./lib/Logger"));
const run_1 = require("./lib/run");
const util_1 = require("./lib/util");
console.log('moo');
go();
async function go() {
    const featureFilter = process.argv[3];
    if (!process.argv[2] || featureFilter === '--help') {
        usageThenExit();
    }
    const base = process.argv[2].replace(/\/$/, '');
    const specl = util_1.getOptionsOrDefault(base);
    const { splits, protoOptions } = util_1.processEnv(process.env, specl.options);
    const logger = new Logger_1.default({ level: process.env.HAIBUN_LOG_LEVEL || 'log' });
    const instances = splits.map(async (split) => {
        const runtime = {};
        return doRun(base, specl, runtime, featureFilter, split, protoOptions, logger);
    });
    const values = await Promise.allSettled(instances);
    let ranResults = values
        .filter((i) => i.status === 'fulfilled')
        .map((i) => i)
        .map((i) => i.value);
    let exceptionResults = values
        .filter((i) => i.status === 'rejected')
        .map((i) => i)
        .map((i) => i.reason);
    const ok = ranResults.every((a) => a.result.ok);
    if (ok && exceptionResults.length < 1) {
        logger.log(ranResults.every((r) => r.output));
        if (protoOptions.options.stay !== 'ok') {
            process.exit(0);
        }
        return;
    }
    console.error(JSON.stringify({
        ran: ranResults
            .filter((r) => !r.result.ok)
            .map((r) => ({ stage: r.result.failure?.stage, details: r.result.failure?.error.details, results: r.result.results?.find((r) => r.stepResults.find((r) => !r.ok)) })),
        exceptionResults,
    }, null, 2));
    if (protoOptions.options.stay !== 'error') {
        process.exit(1);
    }
}
async function doRun(base, specl, runtime, featureFilter, shared, protoOptions, logger) {
    if (protoOptions.options.cli) {
        repl_1.default.start().context.runtime = runtime;
    }
    const world = { ...protoOptions, shared, logger, runtime };
    const { result } = await run_1.run({ specl, base, world, featureFilter, protoOptions });
    const output = await util_1.resultOutput(process.env.HAIBUN_OUTPUT, result, shared);
    return { result, shared, output };
}
function usageThenExit() {
    console.info([
        '',
        `usage: ${process.argv[1]} <project base>`,
        '',
        'Set these environmental variables to control options:\n',
        ...Object.entries(ENV_VARS_1.ENV_VARS).map(([k, v]) => `${k.padEnd(25)} ${v}`),
        '',
    ].join('\n'));
    process.exit(0);
}
//# sourceMappingURL=cli.js.map