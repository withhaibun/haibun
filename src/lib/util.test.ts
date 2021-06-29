import { TStep } from './defs';
import * as util from './util';
import { run } from './run';
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, TestSteps, TestStepsWithOptions } from './TestSteps';
import { getOptionsOrDefault, getDefaultWorld } from './util';

describe('output', () => {
  it('TResult', async () => {
    const base = process.cwd() + '/test/projects/specl/output-asXunit';
    const specl = getOptionsOrDefault(base);

    const { world } = getDefaultWorld();
    const { result } = await run({ specl, base, addSteppers: [TestSteps], world });
    expect(result.ok).toBe(false);
    const output = await util.resultOutput(undefined, result, world.shared);
    expect(typeof output).toBe('object');
    expect(result.results?.length).toBe(2);
  });
  it('AsXUnit', async () => {
    const base = process.cwd() + '/test/projects/specl/output-asXunit';
    const specl = getOptionsOrDefault(base);
    const { world } = getDefaultWorld();

    const { result } = await run({ specl, base, addSteppers: [TestSteps], world });
    expect(result.ok).toBe(false);
    const output = await util.resultOutput('AsXUnit', result, world.shared);
    expect(typeof output).toBe('string');
    expect(output.startsWith('<?xml')).toBeTruthy();
  });
});

const step: TStep = {
  match: /^(?<one>.*?) is (?<two>.*?)$/,
  action: async () => util.actionNotOK('test'),
};

describe('getMatches', () => {
  it('gets named matches', () => {
    expect(util.getNamedMatches(step.match!, 'It is set')).toEqual({ one: 'It', two: 'set' });
  });
});

describe('isLowerCase', () => {
  expect(util.isLowerCase('a')).toBe(true);
  expect(util.isLowerCase('A')).toBe(false);
  expect(util.isLowerCase('0')).toBe(false);
});

describe('processEnv', () => {
  it('process env', () => {
    const specl = util.getDefaultOptions();
    const { protoOptions } = util.processEnv({ HAIBUN_TEST: 'true' }, specl.options);
    expect(protoOptions.extraOptions['HAIBUN_TEST']).toBeDefined();
  });
});

describe('getStepperOptions', () => {
  it('finds stepper options', async () => {
    const steppers = await util.getSteppers({ steppers: [], addSteppers: [TestStepsWithOptions], ...getDefaultWorld() });
    const conc = util.getStepperOptions(HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, 'true', steppers);
    expect(conc).toBeDefined();
  });
  it('fills extra', async () => {
    const { world } = getDefaultWorld();
    const specl = { ...util.getDefaultOptions(), extraOptions: { [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: 'true' } };
    const steppers = await util.getSteppers({ steppers: [], addSteppers: [TestStepsWithOptions], ...getDefaultWorld() });
    util.applyExtraOptions(specl, steppers, world);

    expect(world.options[HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]).toBe(42);
  });
  it('throws for unfilled extra', async () => {
    const { world } = getDefaultWorld();
    const specl = { ...util.getDefaultOptions(), extraOptions: { HAIBUN_NE: 'true' } };
    expect(() => util.applyExtraOptions(specl, [], world)).toThrow();
  });
});
