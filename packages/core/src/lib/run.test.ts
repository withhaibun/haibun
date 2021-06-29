import { run } from './run';
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, TestSteps, TestStepsWithOptions } from './TestSteps';
import { getOptionsOrDefault, getDefaultWorld, processEnv } from './util';

describe('run self-contained', () => {
  it('Backgrounds', async () => {
    const base = process.cwd() + '/test/projects/specl/self-contained';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld() });

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

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld() });

    expect(result.ok).toBe(true);

    expect(result.results!.length).toBe(1);
    const t = result.results![0];
    expect(t).toBeDefined();
    expect(t.ok).toBe(true);
    expect(t.stepResults.length).toBe(3);
    expect(t.stepResults.every((r) => r.ok === true)).toBe(true);
  });
});

describe('fails', () => {
  it('fails', async () => {
    const base = process.cwd() + '/test/projects/specl/fails';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld() });

    expect(result.ok).toBe(false);

    expect(result.failure?.stage).toBe('Resolve');

    expect(result.failure?.error.details.startsWith('no step found for When I fail')).toBe(true);
  });
});

describe('step fails', () => {
  it('step fails', async () => {
    const base = process.cwd() + '/test/projects/specl/step-fails';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld() });

    expect(result.ok).toBe(false);

    expect(result.failure?.stage).toBe('Execute');
  });
});

describe('multiple', () => {
  it('fail and pass', async () => {
    const base = process.cwd() + '/test/projects/specl/multiple';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld() });

    expect(result.ok).toBe(false);
    expect(result.results?.length).toBe(2);

    expect(result.failure?.stage).toBe('Execute');
  });
});

describe('step vars', () => {
  it('step vars', async () => {
    const base = process.cwd() + '/test/projects/specl/vars';
    const specl = getOptionsOrDefault(base);
    const { world } = getDefaultWorld();
    const { result } = await run({ specl, base, addSteppers: [TestSteps], world });

    expect(result.ok).toBe(true);
    expect(world.shared.var).toBe('1');
    expect(world.shared['Var 2']).toBe('2');
    expect(world.shared['Var 3']).toBe('3');
  });
});

describe('handles exception', () => {
  it('handles exception', async () => {
    const base = process.cwd() + '/test/projects/specl/handles-exception';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld() });

    expect(result.ok).toBe(false);

    expect(result.results?.length).toBe(1);
  });
});

describe('haibun', () => {
  it('mixed prose', async () => {
    const base = process.cwd() + '/test/projects/haibun/prose';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld() });

    expect(result.ok).toBe(true);

    expect(result.results?.length).toBe(1);
  });
});

describe('haibun', () => {
  it('mixed prose', async () => {
    const base = process.cwd() + '/test/projects/haibun/prose';
    const specl = getOptionsOrDefault(base);

    const { result } = await run({ specl, base, addSteppers: [TestSteps], ...getDefaultWorld() });

    expect(result.ok).toBe(true);

    expect(result.results?.length).toBe(1);
  });
});

describe('options', () => {
  it('stepper options', async () => {
    const base = process.cwd() + '/test/projects/haibun/stepper-options';
    const { world } = getDefaultWorld();
    const specl = getOptionsOrDefault(base);
    const { protoOptions: protoConfig } = processEnv({ [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: 'true' }, {});
    const { result } = await run({ specl, base, addSteppers: [TestStepsWithOptions], world, protoOptions: protoConfig });

    expect(result.ok).toBe(true);
    expect(result.results?.length).toBe(1);
    expect(result.results![0].stepResults[0].actionResults[0].details).toBe('42');
  });
});
