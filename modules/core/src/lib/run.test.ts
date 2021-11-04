import { run } from './run';
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, TestSteps, TestStepsWithOptions, testWithDefaults } from './TestSteps';
import { getOptionsOrDefault, processEnv } from './util';
import { getDefaultWorld } from './TestSteps';

describe('run self-contained', () => {
  it('Backgrounds', async () => {
    const base = process.cwd() + '/test/projects/specl/self-contained';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld(0) });

    expect(result.ok).toBe(true);
    expect(result.results!.length).toBe(1);
    const t = result.results![0];
    expect(t).toBeDefined();
    expect(t.ok).toBe(true);
    expect(t.stepResults.length).toBe(2);
    expect(t.stepResults.every((r) => r.ok === true)).toBe(true);
  });
});

describe('run backgrounds', () => {
  it('background', async () => {
    const base = process.cwd() + '/test/projects/specl/with-background';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld(0) });

    expect(result.ok).toBe(true);

    expect(result.results!.length).toBe(1);
    const t = result.results![0];
    expect(t).toBeDefined();
    expect(t.ok).toBe(true);

    expect(t.stepResults.length).toBe(1);
    expect(t.stepResults.every((r) => r.ok === true)).toBe(true);
  });
});

describe('fails', () => {
  it('fails', async () => {
    const base = process.cwd() + '/test/projects/specl/fails';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld(0) });

    expect(result.ok).toBe(false);

    expect(result.failure?.stage).toBe('Resolve');

    expect(result.failure?.error.message.startsWith('no step found for When I fail')).toBe(true);
  });
});

describe('step fails', () => {
  it('step fails', async () => {
    const base = process.cwd() + '/test/projects/specl/step-fails';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld(0) });

    expect(result.ok).toBe(false);

    expect(result.failure?.stage).toBe('Execute');
  });
});

describe('multiple', () => {
  it('fail and pass', async () => {
    const base = process.cwd() + '/test/projects/specl/multiple';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld(0) });

    expect(result.ok).toBe(false);
    expect(result.results?.length).toBe(2);

    expect(result.failure?.stage).toBe('Execute');
  });
});

describe('step vars', () => {
  it('step vars', async () => {
    const base = process.cwd() + '/test/projects/specl/vars';
    const specl = getOptionsOrDefault(base);
    const { world } = getDefaultWorld(0);
    const { result } = await run({ specl, base, addSteppers: [TestSteps], world });

    expect(result.ok).toBe(true);
    expect(world.shared.get('var')).toBe('1');
    expect(world.shared.get('Var 2')).toBe('2');
    expect(world.shared.get('Var 3')).toBe('3');
  });
});

describe('handles exception', () => {
  it('handles exception', async () => {
    const feature = { path: '/features/test.feature', content: `When I throw an exception\nThen the test should pass`};
    const { result } = await testWithDefaults([feature], [TestSteps]);

    expect(result.ok).toBe(false);

    expect(result.results?.length).toBe(1);
  });
});

describe('haibun', () => {
  it('mixed prose', async () => {
    const base = process.cwd() + '/test/projects/haibun/prose';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld(0) });

    expect(result.ok).toBe(true);

    expect(result.results?.length).toBe(1);
  });
});