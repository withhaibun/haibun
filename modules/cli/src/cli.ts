#!/usr/bin/env node

import repl from 'repl';
import { TProtoOptions, TResult, TSpecl, TWorld, TTag } from '@haibun/core/build/lib/defs';
import { WorldContext } from '@haibun/core/build/lib/contexts';
import Logger from '@haibun/core/build/lib/Logger';

import { run } from '@haibun/core/build/lib/run';
import { getOptionsOrDefault, resultOutput, getRunTag, writeTraceFile } from '@haibun/core/build/lib/util';
import { ILogOutput } from '@haibun/core/build/lib/interfaces/logger';
import { processBaseEnv, ranResultError, usageThenExit } from './lib';
import { Timer } from '@haibun/core/build/lib/Timer';

export type TRunResult = { output: any, result: TResult, shared: WorldContext, tag: TTag, runStart: number, runDuration: number, fromStart: number };

go();

async function go() {
  const featureFilter = (process.argv[3] || '').split(',');
  const base = process.argv[2].replace(/\/$/, '');
  const specl = getOptionsOrDefault(base);

  if (!process.argv[2] || featureFilter.find(f => f === '--help')) {
    await usageThenExit(specl);
  }
  console.info('\n_________________________________ start');

  const { protoOptions, errors } = processBaseEnv(process.env, specl.options);
  const splits: { [name: string]: string }[] = protoOptions.options.SPLITS || [{}];

  if (errors.length > 0) {
    await usageThenExit(specl, errors.join('\n'));
  }
  const logger = new Logger({ level: protoOptions.options.LOG_LEVEL || 'debug', follow: protoOptions.options.LOG_FOLLOW });
  let allRunResults: PromiseSettledResult<TRunResult>[] = [];

  const loops = protoOptions.options.LOOPS || 1;
  const members = protoOptions.options.MEMBERS || 1;
  const trace = protoOptions.options.TRACE;

  const timer = new Timer();
  let totalRan = 0;
  type TFailure = { sequence: number, runDuration: number, fromStart: number };
  let allFailures: { [message: string]: TFailure[] } = {};

  for (let loop = 1; loop < loops + 1; loop++) {
    if (loops > 1) {
      logger.log(`starting loop ${loop}/${loops}`)
    }
    let groupRuns: Promise<TRunResult>[] = [];
    for (let member = 1; member < members + 1; member++) {
      if (members > 1) {
        logger.log(`starting member ${member + 1}/${members}`)
      }
      const instances = splits.map(async (split) => {
        const runtime = {};
        const tag: TTag = getRunTag(totalRan, loop, member, split, trace);
        totalRan++;

        return doRun(base, specl, runtime, featureFilter, new WorldContext(tag, split), protoOptions, logger, tag, timer);

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

  if (ok && exceptionResults.length < 1) {
    logger.log(ranResults.every((r) => r.output));
  } else {
    try {
      console.error(ranResultError(ranResults, exceptionResults));
    } catch (e) {
      console.error(ranResults[0].result.failure);
    }
  }
  const runTime = timer.since();
  console.info('failures:', JSON.stringify(allFailures, null, 2));
  console.info('\nRESULT>>>', { ok, startDate: Timer.startTime, startTime: Timer.startTime.getTime(), passed, failed, totalRan, runTime, 'features/s:': totalRan / runTime });

  if (ok && exceptionResults.length < 1 && protoOptions.options.STAY !== 'always') {
    process.exit(0);
  } else if (protoOptions.options.STAY !== 'always') {
    process.exit(1);
  }
}

async function doRun(base: string, specl: TSpecl, runtime: {}, featureFilter: string[], shared: WorldContext, protoOptions: TProtoOptions, containerLogger: ILogOutput, tag: TTag, timer: Timer) {
  if (protoOptions.options.CLI) {
    repl.start().context.runtime = runtime;
  }

  const runStart = process.hrtime();
  const logger = new Logger({ output: containerLogger, tag });

  const world: TWorld = { ...protoOptions, shared, logger, runtime, domains: [], tag, timer };

  const { result } = await run({ specl, base, world, featureFilter, protoOptions });
  if (world.options.TRACE) {
    writeTraceFile(world, result);
  }
  const output = await resultOutput(process.env.HAIBUN_OUTPUT, result, shared);

  return { result, shared, output, tag, runStart: runStart[0], runDuration: process.hrtime(runStart)[0], fromStart: timer.since() };
}
