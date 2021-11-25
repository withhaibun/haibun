import * as util from './util';
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, testRun, getDefaultWorld, testWithDefaults } from './test/lib';
import TestSteps from "./test/TestSteps";
import TestStepsWithOptions from "./test/TestStepsWithOptions";
import { withNameType } from './features';

describe('output', () => {
  it('resultOutput default', async () => {
    const features = [{ path: '/features/test.feature', content: `When I have a test\nThen the test can fail` }, { path: '/features/test.feature', content: `When I have a test\nThen the test should pass` }];
    const { result, world } = await testWithDefaults(features, [TestSteps]);

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

describe('getStepperOptions', () => {
  it('finds stepper options', async () => {
    const steppers = await util.getSteppers({ steppers: [], addSteppers: [TestStepsWithOptions], ...getDefaultWorld(0) });
    const conc = util.getStepperOptions(HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, 'true', steppers);
    expect(conc).toBeDefined();
  });
  it('fills extra', async () => {
    const { world } = getDefaultWorld(0);
    const specl = { ...util.getDefaultOptions(), extraOptions: { [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: 'true' } };
    const steppers = await util.getSteppers({ steppers: [], addSteppers: [TestStepsWithOptions], ...getDefaultWorld(0) });
    util.applyExtraOptions(specl, steppers, world);

    expect(world.options[HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]).toEqual({ result: 42 });
  });
  it('throws for unfilled extra', async () => {
    const { world } = getDefaultWorld(0);
    const specl = { ...util.getDefaultOptions(), extraOptions: { HAIBUN_NE: 'true' } };
    expect(() => util.applyExtraOptions(specl, [], world)).toThrow();
  });
});

describe('getType', () => {
  it('finds a type', () => {
    expect(withNameType('file.type.feature', '').type).toBe('type');
  });
  it('finds no type', () => {
    expect(withNameType('file.feature', '').type).toBe('feature');
  })
})
