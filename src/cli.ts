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
  console.log(result);
  if (result.ok) {
    process.exit(0);
  }
}
