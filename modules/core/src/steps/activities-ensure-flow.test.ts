import { describe, it, expect } from 'vitest';
import { failWithDefaults, passWithDefaults } from '../lib/test/lib.js';
import Haibun from './haibun.js';
import VariablesSteppers from './variables-stepper.js';
import ActivitiesStepper from './activities-stepper.js';
import { DEF_PROTO_OPTIONS } from '../lib/test/lib.js';

describe('Activities ensure flow', () => {
	it('should execute activity body then verify proof when proof initially fails', async () => {
		const background = {
			path: '/backgrounds/test.feature',
			content: `
Activity: Set up Wikipedia
set "enWikipedia" to "https://en.wikipedia.org/wiki/"
set "haibunUrl" to "https://en.wikipedia.org/wiki/Haibun"
waypoint Knows about Wikipedia with variable "enWikipedia" is set
`
		};

		const feature = {
			path: '/features/test.feature',
			content: `Feature: Test ensure flow

This test demonstrates the ensure flow.
1. ensure X is called.
2. Check proof - if it passes, done.
3. If proof fails, execute activity body (NOT including waypoint line).
4. Execute proof again to verify.
5. Success if proof now passes, fail otherwise.

Expected flow.
- ensure Knows about Wikipedia.
- Check proof: variable enWikipedia is set → FAILS (not set yet).
- Execute activity body.
  - set enWikipedia to https://en.wikipedia.org/wiki/.
  - set haibunUrl to https://en.wikipedia.org/wiki/Haibun.
  - Note: waypoint line is NOT in activity body to avoid recursion.
- Execute proof: variable enWikipedia is set → PASSES (now set).
- Success.

Scenario: Ensure executes activity body when proof fails
ensure Knows about Wikipedia
variable enWikipedia is "https://en.wikipedia.org/wiki/"
variable haibunUrl is "https://en.wikipedia.org/wiki/Haibun"
`
		};

		const result = await passWithDefaults([feature], [ActivitiesStepper, Haibun, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);

		expect(result.ok).toBe(true);
	});

	it('should skip activity body when proof already passes', async () => {
		// This test shows that if the proof already passes, we skip the activity body

		const background = {
			path: '/backgrounds/test.feature',
			content: `
Activity: Set up Wikipedia
set enWikipedia to https://en.wikipedia.org/wiki/
set counter to 0
waypoint Knows about Wikipedia with variable enWikipedia is set
`
		};

		const feature = {
			path: '/features/test.feature',
			content: `
Feature: Test ensure flow
Scenario: Ensure skips activity when proof passes
set enWikipedia to https://already-set.com/
ensure Knows about Wikipedia
`
		};

		const result = await passWithDefaults([feature], [ActivitiesStepper, Haibun, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);

		expect(result.ok).toBe(true);
	});

	it('should fail if proof fails after activity body execution', async () => {
		// This test shows what happens when the activity body runs but proof still fails

		const background = {
			path: '/backgrounds/test.feature',
			content: `
Activity: Broken setup
set wrongVariable to something
waypoint Needs correct variable with variable correctVariable is set
`
		};

		const feature = {
			path: '/features/test.feature',
			content: `
Feature: Test ensure flow
Scenario: Ensure fails when proof still fails after activity
ensure Needs correct variable
`
		};

		const result = await failWithDefaults([feature], [ActivitiesStepper, Haibun, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);

		expect(result.ok).toBe(false);
	});

	it('should not cause infinite recursion when activity body does NOT include waypoint line', async () => {
		// Critical test: The waypoint line should NOT be in activityBlockSteps
		// This prevents infinite recursion

		const background = {
			path: '/backgrounds/test.feature',
			content: `
Activity: Knows about Wikipedia
set enWikipedia to https://en.wikipedia.org/wiki/
set haibunUrl to https://en.wikipedia.org/wiki/Haibun
waypoint Knows about Wikipedia with variable enWikipedia is set
`
		};

		const feature = {
			path: '/features/test.feature',
			content: `
Feature: Test no infinite recursion
Scenario: Ensure does not recurse infinitely
ensure Knows about Wikipedia
`
		};

		const result = await passWithDefaults([feature], [ActivitiesStepper, Haibun, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
		expect(result.world.runtime.exhaustionError).toBeUndefined(); // No exhaustion hit
	});
});
