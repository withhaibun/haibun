import { describe, it, expect } from 'vitest';
import { withAction } from './withAction.js';
import { toBdd } from './converter.js';
import { ActivitiesStepper } from '../steps/activities-stepper.js';
import VariablesStepper from '../steps/variables-stepper.js';
import { failWithDefaults, passWithDefaults } from '../lib/test/lib.js';
import Haibun from '../steps/haibun.js';

describe('kireji activities', () => {
	it('should convert multi-line proof template strings to BDD format correctly', () => {
		const activitiesStepper = new ActivitiesStepper();
		const { activity, waypoint } = withAction(activitiesStepper);

		const testBackground = {
			'Test Background': [
				activity({ activity: 'Setup variables' }),
				waypoint({
					outcome: 'Variables are set',
					proof: `set x to 1
set y to 2
set z to 3`
				}),
			],
		};

		const bdd = toBdd(testBackground);

		// The BDD should have the waypoint statement with the full proof
		expect(bdd).toContain('waypoint Variables are set with');
		// Check if newlines are preserved
		const lines = bdd.split('\n');
		const waypointLine = lines.find(l => l.includes('waypoint Variables are set with'));
		expect(waypointLine).toBeDefined();
	});

	it('should handle single-line proofs in actual feature execution', async () => {
		const background = {
			path: '/backgrounds/setup.feature',
			content: `Activity: Setup
set xy to "12"
waypoint Has setup with variable xy is "12"`
		};

		const feature = {
			path: '/features/test.feature',
			content: `ensure Has setup
variable xy is "12"`
		};

		const result = await passWithDefaults(
			[feature],
			[ActivitiesStepper, Haibun, VariablesStepper],
			undefined,
			[background]
		);

		expect(result.ok).toBe(true);
	});

	it('should fail at resolve time if outcome is not registered', async () => {
		const feature = {
			path: '/features/test.feature',
			content: 'ensure Nonexistent outcome'
		};

		const result = await failWithDefaults([feature], [ActivitiesStepper, Haibun, VariablesStepper]);

		expect(result.ok).toBe(false);
		expect(result.failure?.stage).toBe('Resolve');
		expect(result.failure?.error.message).toMatch(/Nonexistent outcome|no step found/);
	});

	it('should execute a simple single-line proof', async () => {
		const background = {
			path: '/backgrounds/multi.feature',
			content: `Activity: Navigate to page
set fullUrl to "https://example.com/home"
waypoint On homepage with variable fullUrl is "https://example.com/home"`
		};

		const feature = {
			path: '/features/test.feature',
			content: `ensure On homepage
variable fullUrl is "https://example.com/home"`
		};

		const result = await passWithDefaults(
			[feature],
			[ActivitiesStepper, Haibun, VariablesStepper],
			undefined,
			[background]
		);

		expect(result.ok).toBe(true);
	});
});
