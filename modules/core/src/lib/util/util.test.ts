import * as util from '.';
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, getDefaultWorld, testWithDefaults } from '../test/lib';
import TestSteps from "../test/TestSteps";
import TestStepsWithOptions from "../test/TestStepsWithOptions";
import { withNameType } from '../features';

describe('output', () => {
  it('resultOutput default', async () => {
    const features = [{ path: '/features/test.feature', content: `When I have a test\nThen the test can fail` }, { path: '/features/test.feature', content: `When I have a test\nThen the test should pass` }];
    const { result, world } = await testWithDefaults(features, [TestSteps]);

    expect(result.ok).toBe(false);
    const output = await util.resultOutput(undefined, result);
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
    const steppers = await util.getSteppers({ steppers: [], addSteppers: [TestStepsWithOptions], });
    const conc = util.getStepperOptions(HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, 'true', steppers);
    expect(conc).toBeDefined();
  });
  it('fills extra', async () => {
    const { world } = getDefaultWorld(0);
    const steppers = await util.getSteppers({ steppers: [], addSteppers: [TestStepsWithOptions], });
    util.applyExtraOptions({ [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: 'true' }, steppers, world);

    expect(world.options[HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]).toEqual(42);
  });
  it('throws for unfilled extra', async () => {
    const { world } = getDefaultWorld(0);
    expect(() => util.applyExtraOptions({ HAIBUN_NE: 'true' }, [], world)).toThrow();
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

describe('shouldProcess', () => {
  it('should process no type & filter', () => {
    expect(util.shouldProcess('hi.feature', undefined, undefined)).toBe(true);
  });
  it('should process matching filter', () => {
    expect(util.shouldProcess('hi.feature', undefined, ['hi'])).toBe(true);
  });
  it('should not process wrong type', () => {
    expect(util.shouldProcess('hi.feature', 'wrong', undefined)).toBe(false);
  });
  it('should not process wrong filter', () => {
    expect(util.shouldProcess('hi.feature', undefined, ['wrong'])).toBe(false);
  });
});
