import { it, expect, describe } from 'vitest';

import { failWithDefaults, passWithDefaults } from '../lib/test/lib.js';
import VariablesStepper from './variables-stepper.js';
import { DEFAULT_DEST } from '../lib/defs.js';
import Haibun from './haibun.js';
const steppers = [VariablesStepper, Haibun];

describe('vars', () => {
	it('assigns', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to "1"\nshow var "x"\nvariable "x" is "1"' };
		const res = await passWithDefaults([feature], steppers);

		expect(res.ok).toBe(true);
	});
	it('tracks provenance', async () => {
		const feature = { path: '/features/test.feature', content: 'set x to "1"\nset x to 2' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
		expect(res.world.shared.all()['x']?.provenance?.length).toBe(2);
		expect(res.world.shared.all()['x']?.provenance?.map(p => p.in)).toEqual(['set x to "1"', 'set x to 2']);
	});
	it('empty does not overwrite', async () => {
		const feature = { path: '/features/test.feature', content: 'set empty "x" to y\nset empty "x" to z\nvariable "x" is "y"' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
	it('is set', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to y\nvariable "x" is set' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
});

describe('random vars', () => {
	it('assigns random', async () => {
		const feature = { path: '/features/test.feature', content: 'set r to 70 random characters' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
		const v = res.world.shared.get('r');
		expect(v).toBeDefined();
		expect((v as string).length).toBe(70);
	});
	it('does not assigns empty random', async () => {
		const feature = { path: '/features/test.feature', content: 'set r to 1\nset empty r to 70 random characters' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
		const v = res.world.shared.get('r');
		expect((v as string)).toBe('1');
	});
	it('assigns empty random', async () => {
		const feature = { path: '/features/test.feature', content: 'set empty r to 70 random characters' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
		const v = res.world.shared.get('r');
		expect((v as string).length).toBe(70);
	});
});

describe('variable name literal handling', () => {
	it('set uses literal name even if env collides', async () => {
		const feature = { path: '/f.feature', content: 'set what to "value"' };
		const envVariables = { what: 'ENV' };
		const { world } = await passWithDefaults([feature], steppers, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(world.shared.get('what')).toBe('value');
	});
	it('combine uses literal name even if env collides', async () => {
		const feature = { path: '/f.feature', content: 'set a to "A"\nset b to "B"\ncombine a and b to what' };
		const envVariables = { what: 'ENV' };
		const { ok, world } = await passWithDefaults([feature], steppers, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(ok).toBe(true);
		expect(world.shared.get('what')).toBe('AB');
	});
});


describe('vars between scenarios', () => {
	it('persists variables between scenarios', async () => {
		const features = [{
			path: '/features/test.feature',
			content: `
Scenario: Scenario 1
set "a" to 1
variable "a" is "1"
Scenario: Scenario 2
variable "a" is "1"
`}];
		const res = await passWithDefaults(features, steppers);
		expect(res.ok).toBe(true);
	});
});

describe('vars between features', () => {
	it('clears variables between features', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to y' };
		const anotherFeature = { path: '/features/verify.feature', content: 'not variable "x" is set' };
		const res = await passWithDefaults([feature, anotherFeature], steppers);
		expect(res.ok).toBe(true);
	});
	it('sees env vars between features', async () => {
		const feature = { path: '/features/test.feature', content: 'variable "b" is "1"' };
		const anotherFeature = { path: '/features/verify.feature', content: 'variable "b" is "1"' };
		const envVariables = { b: '1' };
		const res = await passWithDefaults([feature, anotherFeature], steppers, { options: { envVariables, DEST: DEFAULT_DEST }, moduleOptions: {} })
		expect(res.ok).toBe(true);
	});
});

describe('feature variables', () => {
	it('keeps pre-scenario feature variables', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to "y"\nScenario: Checks x\nvariable "x" is "y"' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
	it('persists scenario variable changes to next scenario', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to "y"\nScenario: Sets x\nvariable "x" is "y"\nset "x" to "z"\nScenario: Checks x\nvariable "x" is "z"' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
});

describe('vars between scenarios', () => {
	it('should persist variables across scenarios', async () => {
		const feature = {
			path: 'test.feature',
			content: `

set "feature variable" to "something"

Scenario: Check the variable and set it

variable "feature variable" is "something"

set "feature variable" to "something else"

Scenario: Make sure it persisted from previous scenario

variable "feature variable" is "something else"
` }
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
});

describe('value comparisons', () => {
	it('compares numeric variables', async () => {
		const feature = {
			path: '/features/numbers.feature',
			content: `
set "counter" as number to 5
variable counter is less than 7
not variable counter is less than 5
`
		};
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
	it('fails for invalid numeric comparisons', async () => {
		const feature = {
			path: '/features/invalid-numbers.feature',
			content: `
set "counter" to 10
variable counter is less than 5
`
		};
		const res = await failWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});
	it('does not compare string variables lexically', async () => {
		const feature = {

			path: '/features/strings.feature',
			content: `
set "name" to "Alice"
variable name is less than "Bob"
`
		};
		const res = await failWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});
});

describe('magnitude domains and comparisons', () => {
	it('supports defining magnitude phases and comparing values', async () => {
		const feature = {
			path: '/features/magnitude.feature',
			content: `
ordered set of priority is ["low" "medium" "high"]
set priority as priority to low
variable priority is less than high
not variable point is less than "required"
`
		};
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
	it('fails for invalid magnitude comparisons', async () => {
		const feature = {
			path: '/features/invalid-magnitude.feature',
			content: `
ordered set of phase is ["required" "started" "finished"]
set point as phase to "finished"
variable point is less than "finished"
`
		};
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});

});

describe('enum domains', () => {
	it('registers enum domains and coerces values', async () => {
		const feature = {
			path: '/features/enum.feature',
			content: `
set of traffic is ["red" "yellow" "green"]
set light as traffic to "red"
variable light is "red"
`
		};
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});

	it('prevents less than comparisons on unordered enums', async () => {
		const feature = {
			path: '/features/enum-compare.feature',
			content: `
set of decision is [yes no]
set choice as decision to yes
variable choice is less than no
`
		};
		const res = await failWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});
});
