import { readFileSync } from 'fs';
import { TSpecl } from './lib/defs';
import { run } from './lib/run';

export const base = process.argv[2].replace(/\/$/, '');
try {
  const specl: TSpecl = JSON.parse(readFileSync(`${base}/config.json`, 'utf-8'));
  const res = run({specl, base});
  console.info('result', res);
  process.exit(0);
} catch (e) {
  console.error('missing or not valid project config file.');
  process.exit(1);
}
