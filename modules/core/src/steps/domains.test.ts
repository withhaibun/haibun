import { describe, it, expect } from 'vitest';
import { testWithDefaults } from '../lib/test/lib.js';
import VariablesStepper from './variables-stepper.js';
import Haibun from './haibun.js';
import { AStepper } from '../lib/astepper.js';
import { TStepArgs, TFeatureStep, Origin } from '../lib/defs.js';
import { actionOK } from '../lib/util/index.js';

const steppers = [VariablesStepper, Haibun];

class DoesStepper extends AStepper {
	steps = {
		does: {
			gwta: 'Does {what}',
			action: (args: TStepArgs, featureStep: TFeatureStep) => {
				const map = featureStep?.action?.stepValuesMap;
				if (!map || !map.what) return actionOK();
				// include the leading verb in the stored variable label (supports multi-word names)
				const label = `Does ${map.what.label}`;
				const domain = map.what.domain || 'string';
				this.getWorld().shared.set({ label, value: label, domain, origin: Origin.fallthrough });
				return actionOK();
			}
		}
	};
}

describe('domains', () => {
	it('sets variable with explicit domain', async () => {
		const feature = { path: '/features/d.feature', content: 'set sel:page-locator to "#login"\nvariable "sel" is "#login"' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});
	it('sets multi word variable with domain', async () => {
		const feature = { path: '/features/d.feature', content: 'set sel et poivre:page-locator to "#login"\nvariable sel et poivre is "#login"' };
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

	it.skip('sets variable with json domain', async () => {
		const feature = {
			path: '/features/d.feature', content: `set data:json to "{"a":1}"
variable data:json is "{"a":1}"` };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
		// ensure the variable was stored with domain json in world.shared
		expect(res.world.shared.all().data.domain).toBe('json');
	});

	it('Set Submit:page-locator to selector stores Submit with page-locator domain on value', async () => {
		const feature = { path: '/features/d.feature', content: 'Set Submit:page-locator to //*[@id="submit"]' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);

		const stored = res.world.shared.all()['Submit'];
		expect(stored).toBeDefined();
		expect(stored.domain).toBe('page-locator');
		expect(stored.value).toBe('//*[@id="submit"]');
	});

	it('Does submit:page-locator stores submit with page-locator domain on value', async () => {
		const feature = { path: '/features/d.feature', content: 'Does submit:page-locator' };
		const res = await testWithDefaults([feature], [VariablesStepper, Haibun, DoesStepper]);
		expect(res.ok).toBe(true);
		const stored = res.world.shared.all()['Does submit'];
		expect(stored).toBeDefined();
		expect(stored.domain).toBe('page-locator');
	});

	it('treats single {braces} as literal text', async () => {
		const feature = { path: '/features/d.feature', content: 'set literal to {braces}\nvariable literal is "{braces}"' };
		const res = await testWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});

	it.skip('fails on invalid json domain', async () => {
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
