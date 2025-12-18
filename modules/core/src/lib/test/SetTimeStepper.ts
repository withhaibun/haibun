import { vi } from 'vitest';
import { TStepArgs, OK } from '../../schema/protocol.js';
import { AStepper } from '../astepper.js';

const checkedInt = (p: string, v: string) => {
  if (v === undefined) throw Error(`undefined value "${v}" for ${p}`);
  return parseInt(v, 10);
}
export default class SetTimeStepper extends AStepper {
  steps = {
    setTime: {
      gwta: 'change date to {y}-{m}-{d} {h}:{min}:{s}',
      action: ({ y, m, d, h, min, s }: TStepArgs) => {
        for (const v of [y, m, d, h, min, s]) { if (Array.isArray(v)) throw new Error('date parts must be strings'); }
        const ys = y as string, ms = m as string, ds = d as string, hs = h as string, mins = min as string, ss = s as string;
        const date = new Date(checkedInt('year', ys), checkedInt('month', ms) - 1, checkedInt('day', ds), checkedInt('hour', hs), checkedInt('minute', mins), checkedInt('second', ss));
        vi.setSystemTime(date);
        return Promise.resolve(OK);
      }
    },
  };
}
