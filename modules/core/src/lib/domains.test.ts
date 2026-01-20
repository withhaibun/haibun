import { describe, it, expect } from 'vitest';
import { failWithDefaults, passWithDefaults } from './test/lib.js';
import VariablesStepper from '../steps/variables-stepper.js';
import Haibun from '../steps/haibun.js';
import LogicStepper from '../steps/logic-stepper.js';

const steppers = [VariablesStepper, Haibun, LogicStepper];

describe('domains', () => {
	it('sets variable with explicit domain', async () => {
		const feature = { path: '/features/d.feature', content: 'set sel as string to "#login"\nvariable "sel" is "#login"' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
	it('sets multi word variable with domain', async () => {
		const feature = { path: '/features/d.feature', content: 'set sel et poivre as string to "#login"\nvariable sel et poivre is "#login"' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});

	it('fails on unknown domain in set', async () => {
		const feature = { path: '/features/d.feature', content: 'set x as unknown-domain to "y"' };
		const res = await failWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});

	it('fails on invalid number coercion', async () => {
		const feature = { path: '/features/d.feature', content: 'set n as number to "abc"' };
		const res = await failWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});

	it('sets variable with json domain', async () => {
		const feature = { path: '/features/d.feature', content: `set data as json to ${JSON.stringify({ a: 1 })}\nvariable data is ${JSON.stringify({ a: 1 })}` };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
		// ensure the variable was stored with domain json in world.shared
		expect(res.world.shared.all().data.domain).toBe('json');
		const value = res.world.shared.get('data');
		expect(typeof value).toBe('object');
		expect(value).toEqual({ a: 1 });
	});

	it('Set number', async () => {
		const feature = { path: '/features/d.feature', content: 'set Value as number to 4' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);

		const stepVal = res.world.shared.all()['Value'];
		expect(stepVal).toBeDefined();
		expect(stepVal.domain).toBe('number');
		expect(stepVal.value).toBe('4');
		const value = res.world.shared.get('Value');
		expect(typeof value).toBe('number');
		expect(value).toBe(4);
	});

	it('increment number and compare with is', async () => {
		const feature = { path: '/features/d.feature', content: 'set counter as number to 0\nincrement counter\nvariable counter is 1' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});

	it('whenever loop increment and compare with is', async () => {
		const feature = { path: '/features/d.feature', content: 'set counter as number to 0\nwhenever variable counter is less than 3, increment counter\nvariable counter is 3' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});

	it('fails on invalid json domain', async () => {
		const feature = { path: '/features/d.feature', content: 'set bad as json to "{"a":1"' }; // missing closing quote / brace
		const res = await failWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});

	describe('$ENV$ vars', () => {
		it('substitutes $TEST_VALUE$', async () => {
			const feature = { path: '/features/b.feature', content: 'set fromEnv to $TEST_VALUE$' };
			const res = await passWithDefaults([feature], steppers, { options: { DEST: 'default', envVariables: { TEST_VALUE: 'ok' } }, moduleOptions: {} });
			expect(res.ok).toBe(true);
			const check = await passWithDefaults([{ path: '/features/c.feature', content: 'set fromEnv to $TEST_VALUE$\nvariable "fromEnv" is "ok"' }], steppers, { options: { DEST: 'default', envVariables: { TEST_VALUE: 'ok' } }, moduleOptions: {} });
			expect(check.ok).toBe(true);
		});
	});
});
