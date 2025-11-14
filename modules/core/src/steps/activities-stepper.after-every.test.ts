import { describe, it, expect } from 'vitest';
import { passWithDefaults } from '../lib/test/lib.js';
import ActivitiesStepper from './activities-stepper.js';
import VariablesStepper from './variables-stepper.js';
import Haibun from './haibun.js';

describe('ActivitiesStepper with after every hook', () => {
	it('after every hook should not trigger during waypoint proof verification (substeps)', async () => {
		const feature = {
			path: '/features/test.feature',
			content: `
Activity: Setup test
set counter as number to 0
set verifyCount as number to 0
waypoint Test is ready with set verifyCount as number to 1

after every VariablesStepper, increment counter

ensure Test is ready
variable counter is 0
variable verifyCount is 1
			`
		};

		const result = await passWithDefaults([feature], [Haibun, ActivitiesStepper, VariablesStepper]);
		expect(result.ok).toBe(true);
	});

	it('after every hook should not trigger during ensure outcome execution (substeps)', async () => {
		const feature = {
			path: '/features/test.feature',
			content: `Activity: Setup
set counter as number to 0
waypoint Is ready with variable counter is set

set hookCount as number to 0
after every VariablesStepper, increment hookCount

ensure Is ready
variable hookCount is 0`
		};

		const result = await passWithDefaults([feature], [Haibun, ActivitiesStepper, VariablesStepper]);

		expect(result.ok).toBe(true);
	});

	it('after every hook should trigger for top-level steps only, not substeps', async () => {
		const feature = {
			path: '/features/test.feature',
			content: `Activity: Setup
set counter as number to "0"
waypoint Ready with set counter as number to "1"

set hookCount as number to "0"
after every VariablesStepper, increment hookCount

set someValue to "test"
ensure Ready`
		};

		const result = await passWithDefaults([feature], [Haibun, ActivitiesStepper, VariablesStepper]);

		// hookCount should be "1":
		// - "set someValue to test" is a top-level VariablesStepper action, so hook triggers (hookCount -> 1)
		// - "ensure Ready" is an ActivitiesStepper action, doesn't trigger the VariablesStepper hook
		// - The waypoint proof runs "set counter to 1" (VariablesStepper action) but with NO_CYCLES, so no hook
		// Result: counter="1" (from proof), hookCount="1" (only from the top-level set)
		expect(result.ok).toBe(true);
		expect(result.world.shared.get('hookCount')).toBe(1);
		expect(result.world.shared.get('counter')).toBe(1); // Proof executed
		expect(result.world.shared.get('someValue')).toBe('test');
	});
});
