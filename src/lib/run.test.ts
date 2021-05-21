import { IStepper, IStepperConstructor, notOk, ok } from './defs';
import { run } from './run';
import { getConfigOrDefault } from './util';

const test: IStepperConstructor = class Test implements IStepper {
  steps = {
    test: {
      exact: 'When I have a test',
      action: async (input: any) => ok,
    },
    passes: {
      exact: 'Then the test should pass',
      action: async (input: any) => ok,
    },
    fails: {
      exact: 'Then the test can fail',
      action: async (input: any) => notOk,
    },
    named: {
      match: /^Then the parameter (?<param>.+) is accepted$/,
      action: async ({param}: {param: string}) => {
        return param === 'x' ? ok : notOk
      }
    },
  };
};

describe('run self-contained', () => {
  it('includes', async () => {
    const base = process.cwd() + '/test/projects/specl/self-contained';
    const specl = getConfigOrDefault(base);

    const res = await run({ specl, base, addSteppers: [test] });
    
    expect(res.ok).toBe(true);
    expect(res.results!.length).toBe(2);
    const t = res.results![0];
    expect(t).toBeDefined();
    expect(t.ok).toBe(true);
    expect(t.actionResults.every((r) => r.ok === true)).toBe(true);
  });
});

describe('run backgrounds', () => {
  it('background', async () => {
    const base = process.cwd() + '/test/projects/specl/with-background';
    const specl = getConfigOrDefault(base);

    const res = await run({ specl, base, addSteppers: [test] });

    expect(res.ok).toBe(true);
    expect(res.results!.length).toBe(1);
    const t = res.results![0];
    expect(t).toBeDefined();
    expect(t.ok).toBe(true);
    expect(t.actionResults.every((r) => r.ok === true)).toBe(true);
  });
});

describe('fails', () => {
  it('fails', async () => {
    const base = process.cwd() + '/test/projects/specl/fails';
    const specl = getConfigOrDefault(base);

    const res = await run({ specl, base, addSteppers: [test] });

    expect(res.ok).toBe(false);

    expect(res.failure?.stage).toBe('Resolve');
    
    expect(res.failure?.error.details.startsWith('no step found for When I fail')).toBe(true);
  });
});

describe('step fails', () => {
  it('step fails', async () => {
    const base = process.cwd() + '/test/projects/specl/step-fails';
    const specl = getConfigOrDefault(base);

    const res = await run({ specl, base, addSteppers: [test] });

    expect(res.ok).toBe(false);

    expect(res.failure?.stage).toBe('Investigate');
  });
});
