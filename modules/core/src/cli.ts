#!/usr/bin/env node

import repl from 'repl';
import { TLogger, TProtoOptions, TResult, TShared, TSpecl, TWorld } from './lib/defs';
import { ENV_VARS } from './lib/ENV_VARS';
import Logger from './lib/Logger';

import { run } from './lib/run';
import { getOptionsOrDefault, processEnv, resultOutput } from './lib/util';

console.log('moo');

go();

async function go() {
  const featureFilter = process.argv[3];

  if (!process.argv[2] || featureFilter === '--help') {
    usageThenExit();
  }

  const base = process.argv[2].replace(/\/$/, '');
  const specl = getOptionsOrDefault(base);

  const { splits, protoOptions } = processEnv(process.env, specl.options);
  const logger = new Logger({ level: process.env.HAIBUN_LOG_LEVEL || 'log' });

  const instances = splits.map(async (split: TShared) => {
    const runtime = {};
    return doRun(base, specl, runtime, featureFilter, split, protoOptions, logger);
  });

  const values = await Promise.allSettled(instances);
  let ranResults = values
    .filter((i) => i.status === 'fulfilled')
    .map((i) => <PromiseFulfilledResult<{ output: any; result: TResult; shared: TShared }>>i)
    .map((i) => i.value);
  let exceptionResults = values
    .filter((i) => i.status === 'rejected')
    .map((i) => <PromiseRejectedResult>i)
    .map((i) => i.reason);
  const ok = ranResults.every((a) => a.result.ok);
  if (ok && exceptionResults.length < 1) {
    logger.log(ranResults.every((r) => r.output));
    if (protoOptions.options.stay !== 'ok') {
      process.exit(0);
    }
    return;
  }

  console.error(
    JSON.stringify(
      {
        ran: ranResults
          .filter((r) => !r.result.ok)
          .map((r) => ({ stage: r.result.failure?.stage, details: r.result.failure?.error.details, results: r.result.results?.find((r) => r.stepResults.find((r) => !r.ok)) })),
        exceptionResults,
      },
      null,
      2
    )
  );

  if (protoOptions.options.stay !== 'error') {
    process.exit(1);
  }
}

async function doRun(base: string, specl: TSpecl, runtime: {}, featureFilter: string, shared: TShared, protoOptions: TProtoOptions, logger: TLogger) {
  if (protoOptions.options.cli) {
    repl.start().context.runtime = runtime;
  }
  const world: TWorld = { ...protoOptions, shared, logger, runtime };

  const { result } = await run({ specl, base, world, featureFilter, protoOptions });
  const output = await resultOutput(process.env.HAIBUN_OUTPUT, result, shared);
  return { result, shared, output };
}

function usageThenExit() {
  console.info(
    [
      '',
      `usage: ${process.argv[1]} <project base>`,
      '',
      'Set these environmental variables to control options:\n',
      ...Object.entries(ENV_VARS).map(([k, v]) => `${k.padEnd(25)} ${v}`),
      '',
    ].join('\n')
  );
  process.exit(0);
}
