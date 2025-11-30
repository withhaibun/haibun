import { describe, it, expect } from 'vitest';
import { passWithDefaults } from '../lib/test/lib.js';
import VariablesStepper from './variables-stepper.js';
import Haibun from './haibun.js';
import { failWithDefaults } from '../lib/test/lib.js';

const steppers = [VariablesStepper, Haibun];

describe('VariablesStepper.increment for ordered enums', () => {
	it('initializes unset enum to first value and advances', async () => {
		const feature = { path: '/features/increment-enum.feature', content: `
ordered set of test_stage is ["alpha" "beta" "gamma"]
set empty stage as test_stage to "alpha"
increment stage
variable stage is "beta"
increment stage
variable stage is "gamma"
increment stage
variable stage is "gamma"
` };

		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
	});

	it('fails when incrementing an unset enum variable', async () => {
		const feature = { path: '/features/increment-enum-unset.feature', content: `
ordered set of test_stage is ["alpha" "beta" "gamma"]
increment stage
` };

		const res = await failWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});

	it('falls back to numeric increment for non-enum', async () => {
		const feature = { path: '/features/increment-num.feature', content: `
set counter as number to 0
increment counter
increment counter
` };

		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
		// After two increments from 0, counter should be 2
		expect(Number(res.world.shared.get('counter'))).toBe(2);
	});

	it('fails when incrementing an unset numeric variable', async () => {
		const feature = { path: '/features/increment-num-unset.feature', content: `
increment counter
` };

		const res = await failWithDefaults([feature], steppers);
		expect(res.ok).toBe(false);
	});
});
