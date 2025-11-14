import { describe, it, test, expect } from 'vitest';

import * as util from './index.js';
import { HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, getCreateSteppers } from '../test/lib.js';
import TestSteps from '../test/TestSteps.js';
import TestStepsWithOptions from '../test/TestStepsWithOptions.js';
import { withNameType } from '../features.js';
import { OK, TEST_BASE } from '../defs.js';
import { TAnyFixme } from '../fixme.js';
import { IHasOptions } from '../astepper.js';
import { AStepper } from '../astepper.js';
import { constructorName } from './index.js';

describe('isLowerCase', () => {
	it('is lower case', () => {
		expect(util.isLowerCase('a')).toBe(true);
		expect(util.isLowerCase('A')).toBe(false);
		expect(util.isLowerCase('0')).toBe(false);
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
				action: async () => await Promise.resolve(OK),
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
		const s = await util.findStepperFromOption(steppers, ts, options, 'A', 'B');
		expect(s).toBeDefined();
	});
	it('finds from first multiple options', async () => {
		const ts = new TestOptionsStepper();
		const steppers = await getCreateSteppers([], [TestSteps, TestOptionsStepper]);
		const options = {
			[util.getStepperOptionName(ts, 'optionA')]: 'TestSteps',
			[util.getStepperOptionName(ts, 'B')]: 'TestOptionsStepper',
		};
		const s = util.findStepperFromOption(steppers, ts, options, 'optionA', 'optionB');
		expect(s).toBeDefined();
		expect(constructorName(<AStepper>s)).toBe('TestSteps');
	});
	it('throws for not found stepper', async () => {
		const ts = util.createSteppers([TestOptionsStepper])[0];
		const steppers = await getCreateSteppers([], [TestOptionsStepper]);
		const options = {};
		expect(() => util.findStepperFromOption(steppers, ts, options, 'S')).toThrow;
	});
});

describe('verifyRequiredOptions', () => {
	class TestOptionsStepperWithRequired extends AStepper implements IHasOptions {
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
		};
		steps = {
			test: {
				exact: 'When I have a stepper option',
				action: async () => await Promise.resolve(OK),
			},
		};
	}
	it('has option', () => {
		const toswq = new TestOptionsStepperWithRequired();
		const options = { [util.getStepperOptionName(toswq, 'A')]: 'TestSteps' };
		expect(() => util.verifyRequiredOptions([TestOptionsStepperWithRequired], options)).not.toThrow();
	});
	it('throws for missing option', () => {
		expect(() => util.verifyRequiredOptions([TestOptionsStepperWithRequired], {})).toThrow();
	});
	it('uses altSource', () => {
		const options = { [util.getStepperOptionName(new TestOptionsStepperWithRequired(), 'B')]: 'TestSteps' };
		expect(() => util.verifyRequiredOptions([TestOptionsStepperWithRequired], options)).not.toThrow();
	});
});

describe('getStepperOptions', () => {
	it('finds stepper options', () => {
		const conc = util.getStepperOptionValue(HAIBUN_O_TESTSTEPSWITHOPTIONS_EXISTS, 'true', [TestStepsWithOptions]);
		expect(conc).toBeDefined();
	});
	it('throws for unfilled extra', () => {
		expect(() => util.verifyExtraOptions({ HAIBUN_NE: 'true' }, [])).toThrow();
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
		// biome-disable-next-line @typescript-eslint/no-empty-function
		expect(() => util.checkModuleIsClass(function a() {/* */ }, 'a')).toThrow(undefined);
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
	});
});

describe('optionOrError', () => {
	it('rejects no option', () => {
		expect(util.optionOrError('a', ['b']).parseError).toBeDefined();
	});
	it('rejects undefined option', () => {
		expect(util.optionOrError(undefined as unknown as string, ['b']).parseError).toBeDefined();
	});
	it('returns options', () => {
		expect(util.optionOrError('b', ['b'])).toEqual({ result: 'b' });
	});
});

describe('boolOrError', () => {
	it('returns true', () => {
		expect(util.boolOrError('true')).toEqual({ result: true });
	});
	it('returns false', () => {
		expect(util.boolOrError('false')).toEqual({ result: false });
	});
	it('returns error', () => {
		expect(util.boolOrError('wtw').parseError).toBeDefined();
	});
});

describe('stringOrError', () => {
	it('returns value', () => {
		expect(util.stringOrError('a')).toEqual({ result: 'a' });
	});
	it('returns error', () => {
		expect(() => util.stringOrError(undefined as unknown as TAnyFixme).parseError).toBeDefined();
	});
});
