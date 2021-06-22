#!/usr/bin/env node

import repl from 'repl';
import Logger from './lib/Logger';

import { run } from './lib/run';
import { getConfigOrDefault } from './lib/util';

go();

async function go() {
  const runtime = {};
  const base = process.argv[2].replace(/\/$/, '');
  const featureFilter = process.argv[3];

  const specl = getConfigOrDefault(base);
  repl.start().context.runtime = runtime;
  const { result, shared: sharedOut } = await run({ specl, base, logger: new Logger({ level: process.env.LOG_LEVEL || 'log' }), runtime, featureFilter });
  if (result.ok) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }
  const err = { ...result, results: result.results?.filter((r) => !r.ok).map(r => r.stepResults = r.stepResults.filter(s => !s.ok)) };
  console.error(JSON.stringify(err, null, 2));
}
