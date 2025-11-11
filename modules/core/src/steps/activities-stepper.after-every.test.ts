import { describe, it, expect } from 'vitest';
import { testWithDefaults } from '../lib/test/lib.js';
import ActivitiesStepper from './activities-stepper.js';
import VariablesStepper from './variables-stepper.js';
import Haibun from './haibun.js';

describe('ActivitiesStepper with after every hook', () => {
	it('after every hook should not trigger during waypoint proof verification (substeps)', async () => {
		const feature = {
			path: '/features/test.feature',
			content: `
Activity: Setup test
set counter to "0"
set verifyCount to "0"
waypoint Test is ready with set verifyCount to "1"

after every VariablesStepper, increment counter

ensure Test is ready
			`.trim()
		};

		const result = await testWithDefaults([feature], [Haibun, ActivitiesStepper, VariablesStepper]);

		if (!result.ok) {
			console.log('Test failed:', result.failure);
		}

		// Counter should be "0" - the hook should NOT trigger during waypoint proof verification
		// The waypoint proof includes "set verifyCount to 1" which is a VariablesStepper action
		// but it runs with NO_CYCLES so it doesn't trigger the "after every VariablesStepper" hook
		// "ensure" itself is an ActivitiesStepper action, not VariablesStepper, so it doesn't trigger the hook either
		expect(result.ok).toBe(true);
		expect(result.world.shared.get('counter')).toBe('0');
		expect(result.world.shared.get('verifyCount')).toBe('1'); // Proof ran successfully
	});

	it('after every hook should not trigger during ensure outcome execution (substeps)', async () => {
		const feature = {
			path: '/features/test.feature',
			content: `
Activity: Setup
set counter to "0"
waypoint Is ready with variable counter is set

set hookCount to "0"
after every VariablesStepper, increment hookCount

ensure Is ready
			`.trim()
		};

		const result = await testWithDefaults([feature], [Haibun, ActivitiesStepper, VariablesStepper]);

		// hookCount should still be "0" because:
		// - The waypoint proof runs "variable counter is set" (VariablesStepper action)
		// - But it executes with NO_CYCLES, so the "after every VariablesStepper" hook doesn't trigger
		// - The "ensure" itself is an ActivitiesStepper action, not VariablesStepper
		expect(result.ok).toBe(true);
		expect(result.world.shared.get('hookCount')).toBe('0');
	});

	it('after every hook should trigger for top-level steps only, not substeps', async () => {
		const feature = {
			path: '/features/test.feature',
			content: `
Activity: Setup
set counter to "0"
waypoint Ready with set counter to "1"

set hookCount to "0"
after every VariablesStepper, increment hookCount

set someValue to "test"
ensure Ready
			`.trim()
		};

		const result = await testWithDefaults([feature], [Haibun, ActivitiesStepper, VariablesStepper]);

		// hookCount should be "1":
		// - "set someValue to test" is a top-level VariablesStepper action, so hook triggers (hookCount -> 1)
		// - "ensure Ready" is an ActivitiesStepper action, doesn't trigger the VariablesStepper hook
		// - The waypoint proof runs "set counter to 1" (VariablesStepper action) but with NO_CYCLES, so no hook
		// Result: counter="1" (from proof), hookCount="1" (only from the top-level set)
		expect(result.ok).toBe(true);
		expect(result.world.shared.get('hookCount')).toBe(1);
		expect(result.world.shared.get('counter')).toBe('1'); // Proof executed
		expect(result.world.shared.get('someValue')).toBe('test');
	});
});
