import { describe, it, expect } from 'vitest';
import { testWithDefaults } from '../lib/test/lib.js';
import VariablesStepper from './variables-stepper.js';
import Haibun from './haibun.js';

const steppers = [VariablesStepper, Haibun];

describe('domains', () => {
	it('sets variable with explicit domain', async () => {
		const feature = { path: '/features/d.feature', content: 'set sel:page-locator to "#login"\nvariable "sel" is "#login"' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});

	it('fails on unknown domain in set', async () => {
		const feature = { path: '/features/d.feature', content: 'set x:unknown-domain to "y"' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});

	it('fails on invalid number coercion', async () => {
		const feature = { path: '/features/d.feature', content: 'set n:number to "abc"' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});

	it('sets variable with json domain', async () => {
		// JSON object literal should now be treated literally (no env brace parsing)
		const feature = {
			path: '/features/d.feature', content: `set data:json to {"a":1}
variable "data" is "{"a":1}"` };
		const res = await testWithDefaults([feature], steppers);
		if (!res.ok) {
			// Log minimal diagnostic info
			// @ts-expect-error optional debug field access
			console.error('JSON domain test failure result', res.message || res.result || res);
		}
		expect(res.ok).toBe(true);
	});

	it('treats single {braces} as literal text', async () => {
		const feature = { path: '/features/d.feature', content: 'set literal to {braces}\nvariable "literal" is "{braces}"' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});

	it('fails on invalid json domain', async () => {
		const feature = { path: '/features/d.feature', content: 'set bad:json to "{\\"a\\":1"' }; // missing closing quote / brace
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});

	describe('$ENV$ vars', () => {
		it('substitutes $TEST_VALUE$', async () => {
			const feature = { path: '/features/b.feature', content: 'set fromEnv to $TEST_VALUE$' };
			const res = await testWithDefaults([feature], steppers, { options: { DEST: 'default', envVariables: { TEST_VALUE: 'ok' } }, moduleOptions: {} });
			expect(res.ok).toBe(true);
			const check = await testWithDefaults([{ path: '/features/c.feature', content: 'set fromEnv to $TEST_VALUE$\nvariable "fromEnv" is "ok"' }], steppers, { options: { DEST: 'default', envVariables: { TEST_VALUE: 'ok' } }, moduleOptions: {} });
			expect(check.ok).toBe(true);
		});

		it('errors on missing $MISSING_VALUE$', async () => {
			const feature = { path: '/features/d.feature', content: 'set missing to $MISSING_VALUE$' };
			const res = await testWithDefaults([feature], steppers, { options: { DEST: 'default', envVariables: {} }, moduleOptions: {} });
			expect(res.ok).toBe(false);
		});
	});
});
