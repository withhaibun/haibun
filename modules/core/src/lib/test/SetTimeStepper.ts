import { vi } from 'vitest';
import { TNamed, OK } from '../defs.js';
import { AStepper } from '../astepper.js';

const checkedInt = (p: string, v: string) => {
  if (v === undefined) throw Error(`undefined value "${v}" for ${p}`);
  return parseInt(v, 10);
}
export default class SetTimeStepper extends AStepper {
  steps = {
    setTime: {
      gwta: 'change date to {y}-{m}-{d} {h}:{min}:{s}',
      action: ({ y, m, d, h, min, s }: TNamed) => {
        const date = new Date(checkedInt('year', y), checkedInt('month', m) - 1, checkedInt('day', d), checkedInt('hour', h), checkedInt('minute', min), checkedInt('second', s));
        vi.setSystemTime(date);
        return Promise.resolve(OK);
      }
    },
  };
}
