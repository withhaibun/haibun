import * as util from '.';
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, getDefaultWorld, testWithDefaults, getCreateSteppers } from '../test/lib';
import TestSteps from "../test/TestSteps";
import TestStepsWithOptions from "../test/TestStepsWithOptions";
import { withNameType } from '../features';
import { AStepper, IHasOptions, OK } from '../defs';
import { stringOrError } from '.';

describe('output', () => {
  it('resultOutput default', async () => {
    const features = [{ path: '/features/test.feature', content: `When I have a test\nThen the test can fail` }, { path: '/features/test.feature', content: `When I have a test\nThen the test should pass` }];
    const result = await testWithDefaults(features, [TestSteps]);

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

describe('findStepperFromOptions', () => {
  const TS = class TS extends AStepper implements IHasOptions {
    options = {
      A: {
        desc: 'exists',
        parse: (input: string) => stringOrError(input)
      },
      B: {
        desc: 'exists',
        parse: (input: string) => stringOrError(input)
      },
    };
    steps = {
      test: {
        exact: 'When I have a stepper option',
        action: async () => OK
      },
    };
  };

  it('finds from single option', async () => {
    const ts = new TS();
    const steppers = await getCreateSteppers([], [TS]);
    const options = { [util.getStepperOptionName(ts, 'A')]: 'TS' };
    const s = util.findStepperFromOption(steppers, ts, options, 'A');
    expect(s).toBeDefined();
  });
  it('finds from last multiple options', async () => {
    const ts = new TS();
    const steppers = await getCreateSteppers([], [TS]);
    const options = { [util.getStepperOptionName(ts, 'B')]: 'TS' };
    const s = util.findStepperFromOption(steppers, ts, options, 'A', 'B');
    expect(s).toBeDefined();
  });
  it('finds from first multiple options', async () => {
    const ts = new TS();
    const steppers = await getCreateSteppers([], [TS, TestSteps]);
    const options = { [util.getStepperOptionName(ts, 'A')]: 'TestSteps', [util.getStepperOptionName(ts, 'B')]: 'TS' };
    const s = util.findStepperFromOption<typeof TestSteps>(steppers, ts, options, 'A', 'B');
    expect(s).toBeDefined();
    expect(s.constructor.name).toBe('TestSteps');
  });
  it('throws for not found stepper', async () => {
    const ts = new TS();
    const steppers = await getCreateSteppers([], [TS]);
    const options = {};
    expect(() => util.findStepperFromOption(steppers, ts, options, 'S')).toThrow;;
  });
});

describe('getStepperOptions', () => {
  it('finds stepper options', async () => {
    const conc = util.getStepperOptionValue(HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, 'true', [TestStepsWithOptions]);
    expect(conc).toBeDefined();
  });
  it.skip('fills extra', async () => {
    const { world } = getDefaultWorld(0);
    util.verifyExtraOptions({ [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: 'true' }, [TestStepsWithOptions]);

    expect(world.options[HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]).toEqual(42);
  });
  it('throws for unfilled extra', async () => {
    const { world } = getDefaultWorld(0);
    await expect(async () => util.verifyExtraOptions({ HAIBUN_NE: 'true' }, [])).rejects.toThrow();
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

describe('check module is class', () => {
  it('should pass a class', () => {
    expect(util.checkModuleIsClass(class a { }, 'a')).toEqual(undefined);
  });
  it('should fail a function', () => {
    expect(() => util.checkModuleIsClass(function a() { }, 'a')).toThrow(undefined);
  });
})