import { IStepper, IStepperConstructor, notOk, ok, TStepResult } from './defs';
import { run } from './run';
import { getConfigOrDefault } from './util';

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
    fails: {
      match: /^Then the test can fail$/,
      action: async (input: any) => notOk,
    },
  };
};

describe('run self-contained', () => {
  it('includes', async () => {
    const base = process.cwd() + '/test/projects/specl/self-contained';
    const specl = getConfigOrDefault(base);

    const res = await run({ specl, base, addSteppers: [test] });

    expect(res.ok).toBe(true);
    const t = res.results['self-contained'];
    expect(t).toBeDefined();
    expect(t.ok).toBe(true);
    expect(t.stepResults.every((r: TStepResult) => r.ok === true)).toBe(true);
  });
});

describe('run backgrounds', () => {
  it('background', async () => {
    const base = process.cwd() + '/test/projects/specl/with-background';
    const specl = getConfigOrDefault(base);

    const res = await run({ specl, base, addSteppers: [test] });

    expect(res.ok).toBe(true);
    const t = res.results['with-backgrounds'];
    expect(t).toBeDefined();
    expect(t.ok).toBe(true);
    expect(t.stepResults.every((r: TStepResult) => r.ok === true)).toBe(true);
  });
});

describe('fails', () => {
  it('fails', async () => {
    const base = process.cwd() + '/test/projects/specl/fails';
    const specl = getConfigOrDefault(base);

    const res = await run({ specl, base, addSteppers: [test] });

    expect(res.ok).toBe(false);

    expect(res.failure?.stage).toBe('Resolver');
    expect(res.failure?.error.message).toBe('no step found for When I fail');
  });
});

describe.only('step fails', () => {
  it('step fails', async () => {
    const base = process.cwd() + '/test/projects/specl/step-fails';
    const specl = getConfigOrDefault(base);

    const res = await run({ specl, base, addSteppers: [test] });

    expect(res.ok).toBe(false);
    console.log(res);
    

    expect(res.failure?.stage).toBe('Investigator');
  });
});
