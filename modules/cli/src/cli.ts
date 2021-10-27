#!/usr/bin/env node

import repl from 'repl';
import { TProtoOptions, TResult, TSpecl, TWorld } from '@haibun/core/build/lib/defs';
import { WorldContext } from '@haibun/core/build/lib/contexts';
import Logger, { loggerTag } from '@haibun/core/build/lib/Logger';

import { run } from '@haibun/core/build/lib/run';
import { getOptionsOrDefault, processEnv, resultOutput } from '@haibun/core/build/lib/util';
import { ILogOutput } from '@haibun/core/build/lib/interfaces/logger';
import { ranResultError, usageThenExit } from './lib';

export type TRunResult = { output: any, result: TResult, shared: WorldContext, tag: string, runStart: number, runDuration: number, fromStart: number };

go();

async function go() {
  const featureFilter = process.argv[3];

  if (!process.argv[2] || featureFilter === '--help') {
    usageThenExit();
  }
  console.log('\n_________________________________ start');


  const base = process.argv[2].replace(/\/$/, '');
  const specl = getOptionsOrDefault(base);

  const { protoOptions, errors } = processEnv(process.env, specl.options);
  const splits: { [name: string]: string }[] = protoOptions.options.splits || [{}];

  if (errors.length > 0) {
    usageThenExit(errors.join('\n'));
  }
  const logger = new Logger({ level: protoOptions.options.logLevel || 'log', follow: protoOptions.options.logFollow });
  let allRunResults: PromiseSettledResult<TRunResult>[] = [];
  const loops = protoOptions.options.loops || 1;
  const members = protoOptions.options.members || 1;

  let totalRan = 0;
  let startTime = process.hrtime();
  let startDate = new Date();
  let allFailures: { [name: string]: { message: string, runDuration: number, fromStart: number } } = {};

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
        const tag = loggerTag(loop, member, Object.assign({}, split));
        totalRan++;

        return doRun(base, specl, runtime, featureFilter, new WorldContext(tag, split), protoOptions, logger, tag, startTime);

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
      allFailures[r.tag] = {
        message: r.result.failure?.error.message || 'hmm',
        runDuration: r.runDuration,
        fromStart: r.fromStart
      }
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
  const runTime = process.hrtime(startTime)[0];
  console.log({allFailures});
  console.log('\nRESULT>>>', { ok, startDate, startTime: startDate.getTime(), passed, failed, totalRan, runTime, 'features/s:': totalRan / runTime });

  if (ok && exceptionResults.length < 1 && protoOptions.options.stay !== 'always') {
    process.exit(0);
  } else if (protoOptions.options.stay !== 'always') {
    process.exit(1);
  }
}

async function doRun(base: string, specl: TSpecl, runtime: {}, featureFilter: string, shared: WorldContext, protoOptions: TProtoOptions, containerLogger: ILogOutput, tag: string, startTime: [number, number]) {
  if (protoOptions.options.cli) {
    repl.start().context.runtime = runtime;
  }

  const runStart = process.hrtime();
  const logger = new Logger({ output: containerLogger, tag });

  const world: TWorld = { ...protoOptions, shared, logger, runtime, domains: [], tag };

  const { result } = await run({ specl, base, world, featureFilter, protoOptions });
  const output = await resultOutput(process.env.HAIBUN_OUTPUT, result, shared);
  return { result, shared, output, tag, runStart: runStart[0], runDuration: process.hrtime(runStart)[0], fromStart: process.hrtime(startTime)[0] };
}
