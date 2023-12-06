import { describe, it, test, expect } from 'vitest';

import * as util from './index.js';
import * as TFileSystemJs from './workspace-lib.js';
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, getDefaultWorld, testWithDefaults, getCreateSteppers, TEST_BASE } from '../test/lib.js';
import TestSteps from '../test/TestSteps.js';
import TestStepsWithOptions from '../test/TestStepsWithOptions.js';
import { withNameType } from '../features.js';
import { AStepper, HANDLER_USAGE, IHasHandlers, IHasOptions, OK, TAnyFixme } from '../defs.js';
import { constructorName } from './index.js';

describe('output', () => {
  it('OutputResult default', async () => {
    const features = [
      { path: '/features/test1.feature', content: `When I have a test\nThen fails` },
      { path: '/features/test2.feature', content: `When I have a test\nThen it passes` },
    ];
    const result = await testWithDefaults(features, [TestSteps]);

    expect(result.ok).toBe(false);
    const output = await TFileSystemJs.getOutputResult(undefined, result);
    expect(typeof output).toBe('object');
    expect(result.featureResults?.length).toBe(2);
  });
});

describe('isLowerCase', () => {
  it('is lower case', () => {
    expect(util.isLowerCase('a')).toBe(true);
    expect(util.isLowerCase('A')).toBe(false);
    expect(util.isLowerCase('0')).toBe(false);
  });
});

describe('findHandlers', () => {
  const TEST_HANDLER = 'testHandler';
  class TestStepper extends AStepper {
    // eslint-disable-next-line @typescript-eslint/ban-types
    steps: {};
  }
  it('finds handlers from classes that implement IHasHandler', () => {
    class TestStepperHandler extends TestStepper implements IHasHandlers {
      handlers = { testHandler: { handle: () => undefined } }
    }
    const found = util.findHandlers([new TestStepperHandler()], TEST_HANDLER);
    expect(found.length).toBe(1);
    expect(constructorName(found[0].stepper)).toBe('TestStepperHandler');
  });
  it(`does not find handlers from classes that don't implement IHasHandler`, () => {
    const found = util.findHandlers([new TestStepper()], TEST_HANDLER);
    expect(found.length).toBe(0);
  });
  it(`finds exclusive handler`, () => {
    class ExclusiveTestStepperHandler extends TestStepper implements IHasHandlers {
      handlers = { testHandler: { handle: () => undefined, usage: HANDLER_USAGE.EXCLUSIVE } }
    }
    const found = util.findHandlers([new TestStepper(), new ExclusiveTestStepperHandler()], TEST_HANDLER);
    expect(found.length).toBe(1);
    expect(constructorName(found[0].stepper)).toBe('ExclusiveTestStepperHandler');
  });
  it(`throws error for duplicate exclusives`, () => {
    class ExclusiveTestStepperHandler extends TestStepper implements IHasHandlers {
      handlers = { testHandler: { handle: () => undefined, usage: HANDLER_USAGE.EXCLUSIVE } }
    }
    class ExclusiveTestStepperHandlerToo extends TestStepper implements IHasHandlers {
      handlers = { testHandler: { handle: () => undefined, usage: HANDLER_USAGE.EXCLUSIVE } }
    }

    expect(() => util.findHandlers([new TestStepper(), new ExclusiveTestStepperHandler(), new ExclusiveTestStepperHandlerToo()], TEST_HANDLER)).toThrow();
  });
  it(`removes fallback`, () => {
    class TestStepperHandler extends TestStepper implements IHasHandlers {
      handlers = { testHandler: { handle: () => undefined, } }
    }
    class FallbackTestStepperHandler extends TestStepper implements IHasHandlers {
      handlers = { testHandler: { handle: () => undefined, usage: HANDLER_USAGE.FALLBACK } }
    }
    const found = util.findHandlers([new TestStepperHandler(), new FallbackTestStepperHandler()], TEST_HANDLER);
    expect(found.length).toBe(1);
    expect(constructorName(found[0].stepper)).toBe('TestStepperHandler');
  });
  it(`keeps one fallback from mix pak`, () => {
    class TestStepperHandler extends TestStepper implements IHasHandlers {
      handlers = { testHandler: { handle: () => undefined, } }
    }
    class FallbackTestStepperHandler extends TestStepper implements IHasHandlers {
      handlers = { testHandler: { handle: () => undefined, usage: HANDLER_USAGE.FALLBACK } }
    }
    class FallbackTestStepperHandlerToo extends TestStepper implements IHasHandlers {
      handlers = { testHandler: { handle: () => undefined, usage: HANDLER_USAGE.FALLBACK } }
    }
    const found = util.findHandlers([new TestStepperHandler(), new FallbackTestStepperHandler(), new FallbackTestStepperHandlerToo()], TEST_HANDLER);
    expect(found.length).toBe(1);
    expect(constructorName(found[0].stepper)).toBe('TestStepperHandler');
  });
  it(`keeps first fallback from multiple fallbacks`, () => {
    class FallbackTestStepperHandler extends TestStepper implements IHasHandlers {
      handlers = { testHandler: { handle: () => undefined, usage: HANDLER_USAGE.FALLBACK } }
    }
    class FallbackTestStepperHandlerToo extends TestStepper implements IHasHandlers {
      handlers = { testHandler: { handle: () => undefined, usage: HANDLER_USAGE.FALLBACK } }
    }
    const found = util.findHandlers([new FallbackTestStepperHandler(), new FallbackTestStepperHandlerToo()], TEST_HANDLER);
    expect(found.length).toBe(1);
    expect(constructorName(found[0].stepper)).toBe('FallbackTestStepperHandler');
  });
});

describe('findStepperFromOptions', () => {
  const TestOptionsStepper = class TestOptionsStepper extends AStepper implements IHasOptions {
    options = {
      A: {
        desc: 'A exists',
        parse: (input: string) => util.stringOrError(input),
      },
      B: {
        desc: 'B exists',
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
    const ts = new TestOptionsStepper();
    const steppers = await getCreateSteppers([], [TestOptionsStepper]);
    const options = { [util.getStepperOptionName(ts, 'A')]: 'TestOptionsStepper' };
    const s = util.findStepperFromOption(steppers, ts, options, 'A');
    expect(s).toBeDefined();
  });
  it('finds from last multiple options', async () => {
    const ts = new TestOptionsStepper();
    const steppers = await getCreateSteppers([], [TestOptionsStepper]);
    const options = { [util.getStepperOptionName(ts, 'B')]: 'TestOptionsStepper' };
    const s = util.findStepperFromOption(steppers, ts, options, 'A', 'B');
    expect(s).toBeDefined();
  });
  // FIXME vitest where is TestSteps2 coming from? 
  it('finds from first multiple options', async () => {
    const ts = new TestOptionsStepper();
    const steppers = await getCreateSteppers([], [TestSteps, TestOptionsStepper]);
    const options = { [util.getStepperOptionName(ts, 'optionA')]: 'TestSteps', [util.getStepperOptionName(ts, 'B')]: 'TestOptionsStepper' };
    const s = util.findStepperFromOption(steppers, ts, options, 'optionA', 'optionB');
    expect(s).toBeDefined();
    expect(constructorName(<AStepper>s)).toBe('TestSteps');
  });
  it('throws for not found stepper', async () => {
    const ts = new TestOptionsStepper();
    const steppers = await getCreateSteppers([], [TestOptionsStepper]);
    const options = {};
    expect(() => util.findStepperFromOption(steppers, ts, options, 'S')).toThrow;
  });
});

describe('verifyRequiredOptions', () => {
  class TestOptionsStepperWithReauired extends AStepper implements IHasOptions {
    options = {
      A: {
        required: true,
        altSource: 'B',
        desc: 'A is an option',
        parse: (input: string) => util.stringOrError(input),
      },
      B: {
        desc: 'B is an altsource',
        parse: (input: string) => util.stringOrError(input),
      },
    }
    steps = {
      test: {
        exact: 'When I have a stepper option',
        action: async () => OK,
      },
    };
  }
  it('has option', async () => {
    const options = { [util.getStepperOptionName(new TestOptionsStepperWithReauired(), 'A')]: 'TestSteps' };
    await expect(util.verifyRequiredOptions([TestOptionsStepperWithReauired], options)).resolves.not.toThrow();
  });
  it('throws for missing option', async () => {
    await expect(util.verifyRequiredOptions([TestOptionsStepperWithReauired], {})).rejects.toThrow();
  });
  it('uses altSource', async () => {
    const options = { [util.getStepperOptionName(new TestOptionsStepperWithReauired(), 'B')]: 'TestSteps' };
    await expect(util.verifyRequiredOptions([TestOptionsStepperWithReauired], options)).resolves.not.toThrow();
  });
});

describe('getStepperOptions', () => {
  it('finds stepper options', async () => {
    const conc = util.getStepperOptionValue(HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, 'true', [TestStepsWithOptions]);
    expect(conc).toBeDefined();
  });
  it.skip('fills extra', async () => {
    const { world } = getDefaultWorld(0);
    await util.verifyExtraOptions({ [HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS]: 'true' }, [TestStepsWithOptions]);
    console.log('🤑', JSON.stringify(world.options, null, 2));
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
    expect(util.asError({ a: 1 })).toEqual(new Error({ a: 1 } as TAnyFixme));
  });
  it('should pass an array', () => {
    expect(util.asError([1, 2])).toEqual(new Error([1, 2] as TAnyFixme));
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

describe('optionOrError', () => {
  it('rejects no option', async () => {
    expect(util.optionOrError('a', ['b']).error).toBeDefined();
  });
  it('rejects undefined option', async () => {
    expect(util.optionOrError(undefined, ['b']).error).toBeDefined();
  });
  it('returns options', async () => {
    expect(util.optionOrError('b', ['b'])).toEqual({ result: 'b' });
  });
});

describe('boolOrError', () => {
  it('returns true', async () => {
    expect(util.boolOrError('true')).toEqual({ result: true });
  });
  it('returns false', async () => {
    expect(util.boolOrError('false')).toEqual({ result: false });
  });
  it('returns error', async () => {
    expect(util.boolOrError('wtw').error).toBeDefined();
  });
});

describe('stringOrError', () => {
  it('returns value', async () => {
    expect(util.stringOrError('a')).toEqual({ result: 'a' });
  });
  it('returns error', async () => {
    expect(() => util.stringOrError(undefined).error).toBeDefined();
  });
});

