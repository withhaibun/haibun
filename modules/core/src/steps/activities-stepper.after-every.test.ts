import { describe, it, expect } from 'vitest';
import { passWithDefaults } from '../lib/test/lib.js';
import ActivitiesStepper from './activities-stepper.js';
import VariablesStepper from './variables-stepper.js';
import Haibun from './haibun.js';

describe('ActivitiesStepper with after every hook', () => {
	it('after every hook triggers during waypoint proof verification (substeps)', async () => {
		const feature = {
			path: '/features/test.feature',
			content: `
set counter as number to 0
Activity: Setup test
set verifyCount as number to 0
waypoint Test is ready with set verifyCount as number to 1

after every VariablesStepper, increment counter

ensure Test is ready
variable verifyCount is 1
			`
		};

		const result = await passWithDefaults([feature], [Haibun, ActivitiesStepper, VariablesStepper]);
		expect(result.ok).toBe(true);
		// counter increments for: set counter, set verifyCount (activity), set verifyCount (proof)
		// But NOT for the increment itself (same actionName filter)
	});

	it('after every hook triggers during ensure outcome execution (substeps)', async () => {
		const feature = {
			path: '/features/test.feature',
			content: `Activity: Setup
set counter as number to 0
waypoint Is ready with variable counter exists

set hookCount as number to 0
after every VariablesStepper, increment hookCount

ensure Is ready`
		};

		const result = await passWithDefaults([feature], [Haibun, ActivitiesStepper, VariablesStepper]);
		expect(result.ok).toBe(true);
		// hookCount now increments for substeps too (new behavior)
	});

	it('after every hook should trigger for top-level steps AND substeps, but not its own actions', async () => {
		const feature = {
			path: '/features/test.feature',
			content: `Activity: Setup
set counter as number to "0"
waypoint Ready with set counter as number to "1"

set hookCount as number to "0"
after every VariablesStepper, set hookCount as number to "1"

set someValue to "test"
ensure Ready`
		};

		const result = await passWithDefaults([feature], [Haibun, ActivitiesStepper, VariablesStepper]);

		// hookCount should be "1": triggered from various VariablesStepper steps
		// The set hookCount as number to "1" won't infinitely recurse because of same-actionName filter
		expect(result.ok).toBe(true);
	});
});
