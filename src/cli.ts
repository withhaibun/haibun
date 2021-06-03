import repl from 'repl';
import Logger from './lib/Logger';

import { run } from './lib/run';
import { getConfigOrDefault } from './lib/util';

go();

async function go() {
  const runtime = {};
  const base = process.argv[2].replace(/\/$/, '');

  const specl = getConfigOrDefault(base);
  repl.start().context.runtime = runtime;
  const { result, shared: sharedOut } = await run({ specl, base, logger: new Logger(), runtime });
  if (!result.ok) {
    console.info('result', JSON.stringify({ ok: result.ok, failure: result.failure, failed: result.results?.find(r => !r.ok) }, null, 2), { sharedOut });
  } else {
    console.info('result', JSON.stringify({ ok: result.ok }, null, 2), { sharedOut });
    process.exit(0);
  }
}
