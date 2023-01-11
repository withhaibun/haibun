import { TStartRunCallback, TProtoOptions, TSpecl, TWorld, TTag, TRunOptions, TRunResult, TTagValue, TEndFeatureCallback } from './defs';
import { WorldContext } from './contexts';
import Logger from './Logger';

import { run } from './run';
import { resultOutput, getRunTag } from './util/index.js';
import { ILogOutput } from './interfaces/logger';
import { Timer } from './Timer';

export default async function runWithOptions(runOptions: TRunOptions) {
    const { loops, members, trace, startRunCallback, endFeatureCallback, featureFilter, specl, base, splits, protoOptions } = runOptions;
    const { LOG_LEVEL: logLevel, LOG_FOLLOW: logFollow } = protoOptions.options;

    const logger = new Logger({ level: logLevel || 'debug', follow: logFollow });

    const timer = new Timer();
    let totalRan = 0;
    type TFailure = { sequence: TTagValue, runDuration: number, fromStart: number };
    let allFailures: { [message: string]: TFailure[] } = {};
    let allRunResults: PromiseSettledResult<TRunResult>[] = [];

    for (let loop = 1; loop < loops + 1; loop++) {
        loops > 1 && logger.log(`starting loop ${loop}/${loops}`)
        let groupRuns: Promise<TRunResult>[] = [];
        for (let member = 1; member < members + 1; member++) {
            members > 1 && logger.log(`starting member ${member + 1}/${members}`)
            const instances = splits.map(async (split) => {
                splits.length > 1 && logger.log(`starting instance ${split}`);
                const runtime = {};
                const tag: TTag = getRunTag(totalRan, loop, member, 0, split, trace);
                totalRan++;

                const res = await doRun(base, specl, runtime, featureFilter, new WorldContext(tag, split), protoOptions, logger, tag, timer, startRunCallback, endFeatureCallback);
                return res;

            });
            groupRuns = groupRuns.concat(instances);
        }

        const theseValues = await Promise.allSettled(groupRuns);
        allRunResults = allRunResults.concat(theseValues);
    }

    let ranResults = allRunResults
        .filter((i) => i.status === 'fulfilled')
        .map((i) => <PromiseFulfilledResult<TRunResult>>i)
        .map((i) => i.value);

    let passed = 0;
    let failed = 0;

    for (let r of ranResults) {
        if (r.result.ok) {
            passed++;
        } else {
            let message = r.result?.failure?.error?.message;
            if (!message) {
                try {
                    message = JSON.stringify(r.result.failure);
                } catch (e) {
                    console.error('fail message', e);
                    message = "cannot extract"
                }
            }

            allFailures[message] = (allFailures[message] || []).concat({
                sequence: r.tag.sequence,
                runDuration: r.runDuration,
                fromStart: r.fromStart
            });
            failed++;
        }
    }
    let exceptionResults = allRunResults
        .filter((i) => i.status === 'rejected')
        .map((i) => <PromiseRejectedResult>i)
        .map((i) => i.reason);

    const ok = ranResults.every((a) => a.result.ok);
    const runTime = timer.since();
    return { ok, exceptionResults, ranResults, allFailures, logger, passed, failed, totalRan, runTime };
}

async function doRun(base: string, specl: TSpecl, runtime: {}, featureFilter: string[] | undefined, shared: WorldContext, protoOptions: TProtoOptions, containerLogger: ILogOutput, tag: TTag, timer: Timer, startRunCallback?: TStartRunCallback, endFeatureCallback?: TEndFeatureCallback) {
    const runStart = process.hrtime();
    const logger = new Logger({ output: containerLogger, tag });

    const world: TWorld = { options: protoOptions.options, extraOptions: protoOptions.extraOptions, shared, logger, runtime, domains: [], tag, timer, base };
    if (startRunCallback) {
        startRunCallback(world);
    }

    logger.log(`running with these options: ${JSON.stringify(world.options)})}`);

    const result = await run({ specl, base, world, featureFilter, extraOptions: protoOptions.extraOptions, endFeatureCallback });
    const output = await resultOutput(world.options.OUTPUT, result);

    return { world, result, shared, output, tag, runStart: runStart[0], runDuration: process.hrtime(runStart)[0], fromStart: timer.since() };
}