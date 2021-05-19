import { run } from './lib/run';
import { getConfigOrDefault } from './lib/util';

go();

async function go() {
  const base = process.argv[2].replace(/\/$/, '');

  const specl = getConfigOrDefault(base);
  const res = await run({ specl, base });
  console.info('result', res);
  process.exit(0);
}
