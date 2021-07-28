import * as util from './util';
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, testRun, TestSteps, TestStepsWithOptions } from './TestSteps';
import { getDefaultWorld } from './util';

describe('output', () => {
  it('resultOutput default', async () => {
    const { world } = getDefaultWorld();
    const { result } = await testRun('/test/projects/specl/out-default', [TestSteps], world);

    expect(result.ok).toBe(false);
    const output = await util.resultOutput(undefined, result, world.shared);
    expect(typeof output).toBe('object');
    expect(result.results?.length).toBe(2);
  });
});

describe('isLowerCase', () => {
  expect(util.isLowerCase('a')).toBe(true);
  expect(util.isLowerCase('A')).toBe(false);
  expect(util.isLowerCase('0')).toBe(false);
});

describe('processEnv', () => {
  it('carries extra options', () => {
    const specl = util.getDefaultOptions();
    const { protoOptions } = util.processEnv({ HAIBUN_TEST: 'true' }, specl.options);

    expect(protoOptions.extraOptions['HAIBUN_TEST']).toBeDefined();
  });
  it('split_shared incorrect message', () => {
    const specl = util.getDefaultOptions();

    const { errors } = util.processEnv({ HAIBUN_SPLIT_SHARED: '1,2' }, specl.options);
    expect(errors.length).toBe(1);
  });
  it('processes split_shared', () => {
    const specl = util.getDefaultOptions();
    const { splits } = util.processEnv({ HAIBUN_SPLIT_SHARED: 'foo=1,2' }, specl.options);
    expect(splits).toEqual([{ foo: '1' }, { foo: '2' }]);
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
