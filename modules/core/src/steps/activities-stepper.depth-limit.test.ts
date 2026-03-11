import { describe, it, expect } from 'vitest';

import { failWithDefaults } from '../lib/test/lib.js';
import Haibun from './haibun.js';
import VariablesSteppers from './variables-stepper.js';
import ActivitiesStepper from './activities-stepper.js';
import { DEF_PROTO_OPTIONS } from '../lib/test/lib.js';

describe('Activities depth limit test', () => {
	it('should hit depth limit and fail gracefully', async () => {
		const background = {
			path: '/backgrounds/recursive.feature',
			content: `
Activity: Infinite loop
waypoint Infinite loop with ensure Infinite loop
`
		};

		const feature = {
			path: '/features/test.feature',
			content: `
Feature: Test depth limit
Scenario: Trigger infinite recursion
ensure Infinite loop
`
		};

		const result = await failWithDefaults([feature], [ActivitiesStepper, Haibun, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);

		// Should fail due to depth limit
		expect(result.ok).toBe(false);

		// Check that world runtime has an exhaustion error set
		expect(typeof result.world.runtime.exhaustionError).toBe('string');
	});
});
