import * as util from './index.js';
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, getDefaultWorld, testWithDefaults, getCreateSteppers, TEST_BASE } from '../test/lib.js';
import TestSteps from '../test/TestSteps.js';
import TestStepsWithOptions from '../test/TestStepsWithOptions.js';
import { withNameType } from '../features.js';
import { AStepper, IHasOptions, OK } from '../defs.js';

describe('output', () => {
  it('OutputResult default', async () => {
    const features = [
      { path: '/features/test1.feature', content: `When I have a test\nThen fails` },
      { path: '/features/test2.feature', content: `When I have a test\nThen it passes` },
    ];
    const result = await testWithDefaults(features, [TestSteps]);

    expect(result.ok).toBe(false);
    const output = await util.getOutputResult(undefined, result);
    expect(typeof output).toBe('object');
    expect(result.featureResults?.length).toBe(2);
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
        parse: (input: string) => util.stringOrError(input),
      },
      B: {
        desc: 'exists',
        parse: (input: string) => util.stringOrError(input),
      },
    };
    steps = {
      test: {
        exact: 'When I have a stepper option',
        action: async () => OK,
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
    expect(() => util.findStepperFromOption(steppers, ts, options, 'S')).toThrow;
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
    await expect(async () => util.verifyExtraOptions({ HAIBUN_NE: 'true' }, [])).rejects.toThrow();
  });
});

describe('getType', () => {
  it('finds a type', () => {
    expect(withNameType(TEST_BASE, 'file.type.feature', '').type).toBe('type');
  });
  it('finds no type', () => {
    expect(withNameType(TEST_BASE, 'file.feature', '').type).toBe('feature');
  });
});

describe('check module is class', () => {
  it('should pass a class', () => {
    expect(util.checkModuleIsClass(class a { }, 'a')).toEqual(undefined);
  });
  it('should fail a function', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    expect(() => util.checkModuleIsClass(function a() { }, 'a')).toThrow(undefined);
  });
});

describe('asError', () => {
  it('should pass an error', () => {
    expect(util.asError(new Error('a'))).toEqual(new Error('a'));
  });
  it('should pass a string', () => {
    expect(util.asError('a')).toEqual(new Error('a'));
  });
  it('should pass a number', () => {
    expect(util.asError(1)).toEqual(new Error('1'));
  });
  it('should pass a boolean', () => {
    expect(util.asError(true)).toEqual(new Error('true'));
  });
  it('should pass an object', () => {
    expect(util.asError({ a: 1 })).toEqual(new Error({ a: 1 } as any));
  });
  it('should pass an array', () => {
    expect(util.asError([1, 2])).toEqual(new Error([1, 2] as any));
  });
  it('should pass null', () => {
    expect(util.asError(null)).toEqual(new Error('null'));
  });
  it('should pass undefined', () => {
    expect(util.asError(undefined)).toEqual(new Error());
  });
});

describe('depolite', () => {
  describe('conjunctions', () => {
    test('Given', () => {
      expect(util.dePolite('Given test')).toBe('test');
    });
    test('When', () => {
      expect(util.dePolite('When test')).toBe('test');
    });
    test('Then', () => {
      expect(util.dePolite('Then test')).toBe('test');
    });
    test('And', () => {
      expect(util.dePolite('And test')).toBe('test');
    });
  });
  describe('articles', () => {
    test('The', () => {
      expect(util.dePolite('The test')).toBe('test');
    });
    test('A', () => {
      expect(util.dePolite('A test')).toBe('test');
    });
    test('An', () => {
      expect(util.dePolite('An test')).toBe('test');
    });
  });
  describe('pronouns', () => {
    test('I', () => {
      expect(util.dePolite('I test')).toBe('test');
    });
    test(`I'm`, () => {
      expect(util.dePolite(`I'm test`)).toBe('test');
    });
  });
  describe('combinations', () => {
    test('Given I test', () => {
      expect(util.dePolite('Given I test')).toBe('test');
    });
    test(`Given I am test`, () => {
      expect(util.dePolite(`Given I am test`)).toBe('test');
    });
    test('Given am an test', () => {
      expect(util.dePolite('Given am an test')).toBe('test');
    });
    test('And I should see', () => {
      expect(util.dePolite('And I should see')).toBe('see');
    });
  })
});
