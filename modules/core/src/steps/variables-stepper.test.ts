import { it, expect, describe } from 'vitest';

import { failWithDefaults, passWithDefaults } from '../lib/test/lib.js';
import VariablesStepper from './variables-stepper.js';
import { DEFAULT_DEST } from '../lib/defs.js';
import Haibun from './haibun.js';
import LogicStepper from './logic-stepper.js';
const steppers = [VariablesStepper, Haibun, LogicStepper];

describe('vars', () => {
	it('assigns', async () => {
		const content = 'set x to "1"\nshow var x\nvariable x is "1"'
		const res = await passWithDefaults(content, steppers);

		expect(res.ok).toBe(true);
	});
	it('tracks provenance', async () => {
		const content = 'set x to "1"\nset x to "2"'
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
		expect(res.world.shared.all()['x']?.provenance?.length).toBe(2);
		expect(res.world.shared.all()['x']?.provenance?.map(p => p.in)).toEqual(['set x to "1"', 'set x to "2"']);
	});
	it('empty does not overwrite', async () => {
		const content = 'set empty x to "y"\nset empty x to "z"\nvariable x is "y"'
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it('exists', async () => {
		const content = 'set x to "y"\nvariable x exists'
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
});

describe('random vars', () => {
	it('cannot overwrite read-only variable', async () => {
		const content = 'set x as read-only string to "1"\nset x to "2"'
		const result = await failWithDefaults(content, [VariablesStepper]);
		expect(result.ok).toBe(false);
		expect(result.failure?.error?.message).toContain('Cannot overwrite read-only variable "x"');
	});

	it('assigns random', async () => {
		const content = 'set r to 70 random characters'
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
		const v = res.world.shared.get('r');
		expect(v).toBeDefined();
		expect((v as string).length).toBe(70);
	});
	it('does not assigns empty random', async () => {
		const content = 'set r to 1\nset empty r to 70 random characters'
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
		const v = res.world.shared.get('r');
		expect((v as string)).toBe('1');
	});
	it('assigns empty random', async () => {
		const content = 'set empty r to 70 random characters'
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
		const v = res.world.shared.get('r');
		expect((v as string).length).toBe(70);
	});
});

describe('variable name literal handling', () => {
	it('set fails if literal name collides with env', async () => {
		const content = 'set what to "value"'
		const envVariables = { what: 'ENV' };
		const { ok, world } = await failWithDefaults(content, steppers, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(ok).toBe(false);
	});
	it('combine fails if literal name collides with env', async () => {
		const content = 'set a to "A"\nset b to "B"\ncombine a and b to what'
		const envVariables = { what: 'ENV' };
		const { ok, world } = await failWithDefaults(content, steppers, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(ok).toBe(false);
	});
});


describe('vars between scenarios', () => {
	it('persists variables between scenarios', async () => {
		const content = `
Scenario: Scenario 1
set a to 1
variable a is "1"
Scenario: Scenario 2
variable a is "1"
`
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
});

describe('vars between features', () => {
	it('clears variables between features', async () => {
		const feature = { path: '/features/test.feature', content: 'set x to "y"' };
		const anotherFeature = { path: '/features/verify.feature', content: 'not variable x exists' };
		const res = await passWithDefaults([feature, anotherFeature], steppers);

		expect(res.ok).toBe(true);
	});
	it('sees env vars between features', async () => {
		const content = 'variable b is "1"\nvariable b is "1"'
		const envVariables = { b: '1' };
		const res = await passWithDefaults(content, steppers, { options: { envVariables, DEST: DEFAULT_DEST }, moduleOptions: {} })
		expect(res.ok).toBe(true);
	});
});

describe('feature variables', () => {
	it('keeps pre-scenario feature variables', async () => {
		const content = 'set x to "y"\nScenario: Checks x\nvariable x is "y"'
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it('persists scenario variable changes to next scenario', async () => {
		const content = 'set x to "y"\nScenario: Sets x\nvariable x is "y"\nset x to "z"\nScenario: Checks x\nvariable x is "z"'
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
});

describe('vars between scenarios', () => {
	it('should persist variables across scenarios', async () => {
		const content = `set feature variable to "something"

Scenario: Check the variable and set it

variable feature variable is "something"

set feature variable to "something else"

Scenario: Make sure it persisted from previous scenario

variable feature variable is "something else"
`
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
});

describe('less than comparisons', () => {
	it('compares numeric variables', async () => {
		const content = `set counter as number to 5
variable counter is less than 7
not variable counter is less than 5
`
			;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it('fails for invalid numeric comparisons', async () => {
		const content = `set counter to 10
variable counter is less than 5`
			;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
	it('does not compare string variables lexically', async () => {
		const content = `set name to "Alice"
variable name is less than "Bob"`
			;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
});

describe('more than comparisons', () => {
	it('compares numeric variables', async () => {
		const content = `set counter as number to 5
variable counter is more than 3
not variable counter is more than 5`
			;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it('fails for invalid numeric comparisons', async () => {
		const content = `set counter to 10
variable counter is more than 5`
			;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
	it('does not compare string variables lexically', async () => {
		const content = `set name to "Alice"
variable name is more than "Bob"`;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
	it('compares using ordered domains', async () => {
		const content = `ordered set of phase is ["required" "started" "finished"]
set point as phase to "started"
variable point is more than "required"
not variable point is more than "started"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	})
});

describe('magnitude domains and comparisons', () => {
	it('supports defining magnitude domains for less than', async () => {
		const content = `ordered set of priority is ["low" "medium" "high"]
set priority as priority to "low"
variable priority is less than "high"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it('supports defining magnitude domains for not less than', async () => {
		const content = `ordered set of priority is ["low" "medium" "high"]
set priority as priority to "low"
not variable priority is less than "low"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it('supports defining magnitude domains for more than', async () => {
		const content = `ordered set of priority is ["low" "medium" "high"]
set priority as priority to "medium"
variable priority is more than "low"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it('supports defining magnitude domains for not more than', async () => {
		const content = `ordered set of priority is ["low" "medium" "high"]
set priority as priority to "medium"
not variable priority is more than "medium"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it('fails for invalid magnitude comparisons', async () => {
		const content = `ordered set of priority is ["low" "medium" "high"]
set priority as priority to "low"
not variable priority is more than "low"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it('fails for invalid magnitude comparisons', async () => {
		const content = `ordered set of phase is ["required" "started" "finished"]
set point as phase to "finished"
variable point is less than "finished"`;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
});

describe('enum domains', () => {
	it('registers enum domains and coerces values', async () => {
		const content = `set of traffic is ["red" "yellow" "green"]
set light as traffic to "red"
variable light is "red"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});

	it('prevents less than comparisons on unordered enums', async () => {
		const content = `set of decision is [yes no]
set choice as decision to yes
variable choice is less than no`;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
});

describe('enum superdomains', () => {
	it('inherits values from referenced superdomains', async () => {
		const content = `set of baseColors is ["red" "green"]
set of accentColors is ["green" "blue"]
set of derivedColors as [baseColors accentColors]
set color as derivedColors to "red"
set color as derivedColors to "blue"
variable color is "blue"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});

	it('fails when a superdomain is missing', async () => {
		const content = `set of derived as [missingSuperdomain]`;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
});

describe('superdomain base and mixed types', () => {
	it('supports derived domains from base types', async () => {
		const content = `
set of textValues as [string]
set headline as textValues to "Hello"
variable headline is "Hello"
`
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});

	it('supports mixing enums with base domain schemas', async () => {
		const content = `set of palette is ["sun" "moon"]
set of blendedSuper as [palette string]
set shade as blendedSuper to "anything"
variable shade is "anything"
set shade as blendedSuper to "sun"
variable shade is "sun"`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
});

describe('isSet', () => {
	it('passes when variable exists', async () => {
		const content = `set setVar to "value"
variable setVar exists`;
		const res = await passWithDefaults(content, steppers);
		expect(res.ok).toBe(true);
	});
	it('fails when variable is not set', async () => {
		const content = `variable unsetVar exists`;
		const res = await failWithDefaults(content, steppers);
		expect(res.ok).toBe(false);
	});
	it('passes when variable is in env', async () => {
		const content = `variable "fromenv" exists`;
		const envVariables = { fromenv: '1' };
		const res = await passWithDefaults(content, steppers, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(res.ok).toBe(true);
	});
	it('set uses env variable value when available', async () => {
		const content = `set x to fromenv
variable x is "1"`;
		const envVariables = { fromenv: '1' };
		const res = await passWithDefaults(content, steppers, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(res.ok).toBe(true);
	});
});


