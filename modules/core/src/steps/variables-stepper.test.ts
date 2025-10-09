import { it, expect, describe } from 'vitest';

import { testWithDefaults } from '../lib/test/lib.js';
import VariablesStepper from './variables-stepper.js';
import { DEFAULT_DEST } from '../lib/defs.js';
import Haibun from './haibun.js';
const steppers = [VariablesStepper, Haibun];

describe('vars', () => {
	it('assigns', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to "1"\nshow var "x"\nvariable "x" is "1"' };
		const res = await testWithDefaults([feature], steppers);

		expect(res.ok).toBe(true);
	});
	it('tracks provenance', async () => {
		const feature = { path: '/features/test.feature', content: 'set x to "1"\nset x to 2' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
		expect(res.world.shared.all()['x']?.provenance?.length).toBe(2);
		expect(res.world.shared.all()['x']?.provenance?.map(p => p.in)).toEqual(['set x to "1"', 'set x to 2']);
	});
	it('empty does not overwrite', async () => {
		const feature = { path: '/features/test.feature', content: 'set empty "x" to y\nset empty "x" to z\nvariable "x" is "y"' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
	it('is set', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to y\nvariable "x" is set' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
});

describe('random vars', () => {
	it('assigns random', async () => {
		const feature = { path: '/features/test.feature', content: 'set r to 70 random characters' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
		const v = res.world.shared.get('r');
		expect(v).toBeDefined();
		expect((v as string).length).toBe(70);
	});
	it('does not assigns empty random', async () => {
		const feature = { path: '/features/test.feature', content: 'set r to 1\nset empty r to 70 random characters' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
		const v = res.world.shared.get('r');
		expect((v as string)).toBe('1');
	});
	it('assigns empty random', async () => {
		const feature = { path: '/features/test.feature', content: 'set empty r to 70 random characters' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
		const v = res.world.shared.get('r');
		expect((v as string).length).toBe(70);
	});
});

describe('variable name literal handling', () => {
	it('set uses literal name even if env collides', async () => {
		const feature = { path: '/f.feature', content: 'set what to "value"' };
		const envVariables = { what: 'ENV' };
		const { world } = await testWithDefaults([feature], steppers, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(world.shared.get('what')).toBe('value');
	});
	it('combine uses literal name even if env collides', async () => {
		const feature = { path: '/f.feature', content: 'set a to "A"\nset b to "B"\ncombine a and b to what' };
		const envVariables = { what: 'ENV' };
		const { ok, world } = await testWithDefaults([feature], steppers, { options: { DEST: DEFAULT_DEST, envVariables }, moduleOptions: {} });
		expect(ok).toBe(true);
		expect(world.shared.get('what')).toBe('AB');
	});
});


describe('vars between scenarios', () => {
	it('clears variables between scenarios', async () => {
		const features = [{
			path: '/features/test.feature',
			content: `
Scenario: Scenario 1
set "a" to 1
variable "a" is "1"
Scenario: Scenario 2
not variable "a" is set
`}];
		const res = await testWithDefaults(features, steppers);
		expect(res.ok).toBe(true);
	});
});

describe('vars between features', () => {
	it('clears variables between features', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to y' };
		const anotherFeature = { path: '/features/verify.feature', content: 'not variable "x" is set' };
		const res = await testWithDefaults([feature, anotherFeature], steppers);
		expect(res.ok).toBe(true);
	});
	it('sees env vars between features', async () => {
		const feature = { path: '/features/test.feature', content: 'variable "b" is "1"' };
		const anotherFeature = { path: '/features/verify.feature', content: 'variable "b" is "1"' };
		const envVariables = { b: '1' };
		const res = await testWithDefaults([feature, anotherFeature], steppers, { options: { envVariables, DEST: DEFAULT_DEST }, moduleOptions: {} })
		expect(res.ok).toBe(true);
	});
});

describe('feature variables', () => {
	it('keeps pre-scenario feature variables', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to "y"\nScenario: Checks x\nvariable "x" is "y"' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
	it('does not overwrite feature variables', async () => {
		const feature = { path: '/features/test.feature', content: 'set "x" to "y"\nScenario: Sets x\nvariable "x" is "y"\nset "x" to "z"\nScenario: Checks x\nvariable "x" is "y"' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
});

describe('vars between scenarios', () => {
	it('should encapsulate variables to each scenario', async () => {
		const feature = {
			path: 'test.feature',
			content: `

set "feature variable" to "something"

Scenario: Check the variable and set it

variable "feature variable" is "something"

set "feature variable" to "something else"

Scenario: Make sure it is still the feature variable value

variable "feature variable" is "something"
` }
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
});
