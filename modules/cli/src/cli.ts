#!/usr/bin/env node

import repl from 'repl';
import { TProtoOptions, TResult, TSpecl, TWorld } from '@haibun/core/build/lib/defs';
import { WorldContext } from '@haibun/core/build/lib/contexts';
import Logger from '@haibun/core/build/lib/Logger';

import { run } from '@haibun/core/build/lib/run';
import { getOptionsOrDefault, processEnv, resultOutput } from '@haibun/core/build/lib/util';
import { ILogOutput } from '@haibun/core/build/lib/interfaces/logger';
import { ranResultError, usageThenExit } from './lib';

export type TRunResult = { output: any, result: TResult, shared: WorldContext };

go();

async function go() {
  const featureFilter = process.argv[3];

  if (!process.argv[2] || featureFilter === '--help') {
    usageThenExit();
  }

  const base = process.argv[2].replace(/\/$/, '');
  const specl = getOptionsOrDefault(base);

  const { protoOptions, errors } = processEnv(process.env, specl.options);
  const splits: { [name: string]: string }[] = protoOptions.options.splits || [{}];

  if (errors.length > 0) {
    usageThenExit(errors.join('\n'));
  }
  const logger = new Logger({ level: process.env.HAIBUN_LOG_LEVEL || 'log' });
  let allRunResults: PromiseSettledResult<TRunResult>[] = [];
  const loops = protoOptions.options.loops || 1;
  const members = protoOptions.options.members || 1;

  let totalRan = 0;

  for (let loop = 0; loop < loops; loop++) {
    if (loops > 1) {
      logger.log(`starting loop ${loop+1}/${loops}`)
    }
    let groupResults: Promise<TRunResult>[] = [];
    for (let member = 0; member < members; member++) {
      if (members > 1) {
        logger.log(`starting member ${member+1}/${members}`)
      }
      const instances = splits.map(async (split) => {
        const runtime = {};
        const tag = `l${loop}-m${member}-s${split.toString()}`
        totalRan++;

        return doRun(base, specl, runtime, featureFilter, new WorldContext(tag, split), protoOptions, logger, tag);
      });
      groupResults = groupResults.concat(instances);
    }

    const theseValues = await Promise.allSettled(groupResults);
    allRunResults = allRunResults.concat(theseValues);
  }

  let ranResults = allRunResults
    .filter((i) => i.status === 'fulfilled')
    .map((i) => <PromiseFulfilledResult<TRunResult>>i)
    .map((i) => i.value);
  let exceptionResults = allRunResults
    .filter((i) => i.status === 'rejected')
    .map((i) => <PromiseRejectedResult>i)
    .map((i) => i.reason);
  const ok = ranResults.every((a) => a.result.ok);

  if (ok && exceptionResults.length < 1) {
    logger.log(ranResults.every((r) => r.output));
    if (protoOptions.options.stay !== 'always') {
      process.exit(0);
    }
    return;
  }

  try {
    console.error(ranResultError(ranResults, exceptionResults));
  } catch (e) {
    console.error(ranResults[0].result.failure);
  }

  if (protoOptions.options.stay !== 'always') {
    process.exit(1);
  }
}

async function doRun(base: string, specl: TSpecl, runtime: {}, featureFilter: string, shared: WorldContext, protoOptions: TProtoOptions, containerLogger: ILogOutput, tag: string) {
  if (protoOptions.options.cli) {
    repl.start().context.runtime = runtime;
  }
  const logger = new Logger({ output: containerLogger, tag });

  const world: TWorld = { ...protoOptions, shared, logger, runtime, domains: [] };

  const { result } = await run({ specl, base, world, featureFilter, protoOptions });
  const output = await resultOutput(process.env.HAIBUN_OUTPUT, result, shared);
  return { result, shared, output };
}
