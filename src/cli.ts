#!/usr/bin/env node

import repl from 'repl';
import { TResult, TShared } from './lib/defs';
import Logger from './lib/Logger';

import { run } from './lib/run';
import { getConfigOrDefault, resultOutput } from './lib/util';

go();

async function go() {
  const base = process.argv[2].replace(/\/$/, '');
  const featureFilter = process.argv[3];

  let splits: TShared[] = [{}];
  Object.entries(process.env).filter(([k, v]) => k.startsWith('HAIBUN_SPLIT_')).map(([k, v]) => {
    if (k === 'HAIBUN_SPLIT_SHARED') {
      const [what, s] = v!.split('=');
      splits = s.split(',').map((w: string) => ({[what]: w}));
    }
    return {};
  });

  const instances = splits.map(async (split: TShared) => {
    const runtime = {};
    return doRun(base, runtime, featureFilter, split);
  });

  const values = await Promise.allSettled(instances);
  let ranResults = values.filter((i) => i.status === 'fulfilled').map((i) => <PromiseFulfilledResult<{output: any, result: TResult, shared: TShared}>>i).map((i) => i.value);
  let exceptionResults = values.filter((i) => i.status === 'rejected').map((i) => <PromiseRejectedResult>i).map((i) => i.reason);
  const ok = ranResults.every(a => a.result.ok);
  if (ok && exceptionResults.length < 1) {
    console.log(ranResults.every(r => r.output));
    process.exit(0);
  }
  console.error(JSON.stringify({ranResults, failedResults: exceptionResults}, null, 2));
}

async function doRun(base: string, runtime: {}, featureFilter: string, shared: TShared) {
  const specl = getConfigOrDefault(base);
  repl.start().context.runtime = runtime;
  const { result, shared: sharedOut } = await run({ specl, base, logger: new Logger({ level: process.env.LOG_LEVEL || 'log' }), runtime, featureFilter, shared });
  const output = await resultOutput(process.env.HAIBUN_OUTPUT, result, sharedOut);
  return {result, shared: sharedOut, output};
}
