import { readFileSync } from 'fs';
import { IStepper, IStepperConstructor, ok, TSpecl } from './defs';
import { run } from './run';

const test: IStepperConstructor = class Test implements IStepper {
  steps = {
    test: {
      match: /^When I have a test$/,
      action: async (input: any) => ok,
    },
    passes: {
      match: /^Then the test should pass$/,
      action: async (input: any) => ok,
    },
  };
};

describe('run self-contained', () => {
  it('includes', async () => {
    const base = process.cwd() + '/test/projects/specl/self-contained';
    const specl: TSpecl = JSON.parse(readFileSync(`${base}/config.json`, 'utf-8'));

    const res = await run({ specl, base, addSteppers: [test] });

    expect(res.ok).toBe(true);
    expect(res.results).toEqual({ 'self-contained': { ok: true } });
  });
});

describe('run backgrounds', () => {
  it('background', async () => {
    const base = process.cwd() + '/test/projects/specl/with-background';
    const specl: TSpecl = JSON.parse(readFileSync(`${base}/config.json`, 'utf-8'));

    const res = await run({ specl, base, addSteppers: [test] });

    expect(res.ok).toBe(true);
    expect(res.results).toEqual({ 'with-backgrounds': { ok: true } });
  });
});
