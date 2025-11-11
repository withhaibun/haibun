import { describe, it, expect } from 'vitest';
import { passWithDefaults } from '../lib/test/lib.js';
import Haibun from './haibun.js';
import VariablesSteppers from './variables-stepper.js';
import ActivitiesStepper from './activities-stepper.js';
import { DEF_PROTO_OPTIONS } from '../lib/test/lib.js';

describe('Activities recursion test', () => {
	it('should not infinitely recurse when activity includes waypoint', async () => {
		const background = {
			path: '/backgrounds/test.feature',
			content: `
Activity: Setup
set counter as number to 0
waypoint Setup complete with variable counter is 0
`
		};

		const feature = {
			path: '/features/test.feature',
			content: `
Feature: Test recursion
Scenario: Ensure setup
ensure Setup complete
variable counter is 0
`
		};

		const result = await passWithDefaults(
			[feature],
			[ActivitiesStepper, Haibun, VariablesSteppers],
			DEF_PROTO_OPTIONS,
			[background]
		);

		expect(result.ok).toBe(true);
	});
});
