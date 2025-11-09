import { describe, it, expect } from 'vitest';
import { testWithDefaults } from './test/lib.js';
import Haibun from '../steps/haibun.js';
import VariablesSteppers from '../steps/variables-stepper.js';
import ActivitiesStepper from '../steps/activities-stepper.js';
import { DEF_PROTO_OPTIONS } from './test/lib.js';

describe('Logic system - dependency-based execution (waypoint/ensure/forget)', () => {
	it('should only execute the requested Activity from multiple in one background', async () => {
		// Background file with multiple Activities - only one should execute
		const multipleOutcomes = {
			path: '/backgrounds/outcomes.feature',
			content: `
Activity: Login as admin
waypoint Is logged in as admin with set loginType to "admin"

Activity: Login as user
waypoint Is logged in as user with set loginType to "user"

Activity: Login as guest
waypoint Is logged in as guest with set loginType to "guest"
`
		};

		// Main test - only uses the "user" login
		const mainFeature = {
			path: '/features/tests/main.feature',
			content: `
Feature: Multi-outcome test
Scenario: Use only one outcome
ensure Is logged in as user
variable loginType is "user"
`
		};

		const result = await testWithDefaults(
			[mainFeature],
			[ActivitiesStepper, Haibun, VariablesSteppers],
			DEF_PROTO_OPTIONS,
			[multipleOutcomes]
		);

		if (!result.ok) {
			console.log('=== TEST FAILED ===');
			if (result.failure) {
				console.log('Failure:', result.failure.stage, result.failure.error.message);
			}
			if (result.featureResults?.[0]) {
				const fr = result.featureResults[0];
				const failed = fr.stepResults?.filter(s => !s.ok) || [];
				console.log(`Failed steps (${failed.length}):`);
				failed.forEach((s, i) => {
					// @ts-expect-error - accessing internal message
					console.log(`  ${i}: "${s.in}" - ${s.stepActionResult?.message || JSON.stringify(s.stepActionResult)}`);
				});
			}
		}

		expect(result.ok).toBe(true);
	});

	it('should handle full dependency chain: login -> create widget -> delete widget', async () => {
		// Define recipe backgrounds (don't auto-execute, just register patterns)
		const loginRecipe = {
			path: '/backgrounds/login-recipe.feature',
			content: `
Activity: Login
waypoint Is logged in as {user} with set "loggedIn" to "true"
`
		};

		const createWidgetRecipe = {
			path: '/backgrounds/create-widget-recipe.feature',
			content: `
Activity: Create widget
waypoint Created widget {widgetName} that is {width} by {height} with set "widgetCreated" to "true"
`
		};

		const deleteWidgetRecipe = {
			path: '/backgrounds/delete-widget-recipe.feature',
			content: `
Activity: Delete widget
waypoint Deleted widget {widgetName} with set "widgetDeleted" to "true"
`
		};

		// Main test feature - backgrounds are automatically included
		const mainFeature = {
			path: '/features/tests/main.feature',
			content: `
Feature: Widget Management Test
Scenario: Create and delete a widget
ensure Is logged in as "admin"
ensure Created widget "SuperWidget" that is "42" by "42"
ensure Deleted widget "SuperWidget"
variable loggedIn is "true"
variable widgetCreated is "true"
variable widgetDeleted is "true"
`
		};

		const result = await testWithDefaults(
			[mainFeature],
			[ActivitiesStepper, Haibun, VariablesSteppers],
			DEF_PROTO_OPTIONS,
			[loginRecipe, createWidgetRecipe, deleteWidgetRecipe]
		);

		expect(result.ok).toBe(true);
	});

	it('should memoize conditions (not re-execute if already satisfied)', async () => {
		const loginRecipe = {
			path: '/backgrounds/login-recipe.feature',
			content: `Activity: Login
waypoint Is logged in as {user} with set loggedIn to "true"`
		};

		const mainFeature = {
			path: '/features/tests/main.feature',
			content: `
Feature: Multiple Ensures Test
Scenario: Use same condition twice
ensure Is logged in as "Admin"
ensure Is logged in as "Admin"
variable loggedIn is "true"
`
		};

		const result = await testWithDefaults(
			[mainFeature],
			[ActivitiesStepper, Haibun, VariablesSteppers],
			DEF_PROTO_OPTIONS,
			[loginRecipe]
		);

		if (!result.ok) {
			console.log('\n[TEST] Memoize test failed - result.ok =', result.ok);
			if (result.failure) {
				console.log('[TEST] Failure:', result.failure);
			}
			if (result.featureResults?.[0]) {
				const fr = result.featureResults[0];
				console.log('[TEST] Feature ok:', fr.ok);
				if (!fr.ok && fr.stepResults) {
					const failed = fr.stepResults.filter(s => !s.ok);
					console.log(`[TEST] ${failed.length} failed steps:`);
					failed.forEach((s, i) => {
						// @ts-expect-error - accessing internal message property
						console.log(`  ${i}: "${s.in}" - ${s.stepActionResult?.message || 'no message'}`);
					});
				}
			}
		}

		expect(result.ok).toBe(true);
	});

	it('should re-execute condition after explicit forget', async () => {
		const loginRecipe = {
			path: '/backgrounds/login-recipe.feature',
			content: `Activity: Login count
waypoint Is logged in as {user} with set "loggedIn" to "true"`
		};

		const mainFeature = {
			path: '/features/tests/main.feature',
			content: `
Feature: Login/Logout Test
Scenario: Login, logout, login again
ensure Is logged in as "Admin"
variable loggedIn is "true"
forget Is logged in as "Admin"
set loggedIn to "false"
ensure Is logged in as "Admin"
variable loggedIn is "true"
`
		};

		const result = await testWithDefaults(
			[mainFeature],
			[ActivitiesStepper, Haibun, VariablesSteppers],
			DEF_PROTO_OPTIONS,
			[loginRecipe]
		);

		if (!result.ok) {
			console.log('=== FORGET TEST FAILED ===');
			console.log('result.ok:', result.ok);
			if (result.failure) {
				console.log('Failure:', result.failure.stage, result.failure.error.message);
			}
			if (result.featureResults?.[0]) {
				const fr = result.featureResults[0];
				const failed = fr.stepResults?.filter(s => !s.ok) || [];
				console.log(`Failed steps (${failed.length}):`);
				failed.forEach((s, i) => {
					// @ts-expect-error - accessing internal message property
					console.log(`  ${i}: "${s.in}" - ${s.stepActionResult?.message || JSON.stringify(s.stepActionResult)}`);
				});
			}
		}

		expect(result.ok).toBe(true);
	});

	it('should handle multiple variable bindings correctly', async () => {
		const loginRecipe = {
			path: '/backgrounds/login-recipe.feature',
			content: `Activity: Login tracking
waypoint Is logged in as {user} with set lastUser to {user}`
		};

		const mainFeature = {
			path: '/features/tests/main.feature',
			content: `
Feature: Multi-user Test
Scenario: Different users can log in
ensure Is logged in as "Alice"
variable lastUser is "Alice"
ensure Is logged in as "Bob"
variable lastUser is "Bob"
`
		};

		const result = await testWithDefaults(
			[mainFeature],
			[ActivitiesStepper, Haibun, VariablesSteppers],
			DEF_PROTO_OPTIONS,
			[loginRecipe]
		);

		expect(result.ok).toBe(true);
	});

	it('outcomes from backgrounds are shared, but feature outcomes are isolated', async () => {
		const setupBackground = {
			path: '/backgrounds/setup.feature',
			content: 'waypoint Shared setup with set "shared" to "yes"',
		};

		const featureC = {
			path: '/features/featureC.feature',
			content: `
Feature: Feature C
waypoint Feature C outcome with set "featureC" to "yes"
ensure Shared setup
variable "shared" is "yes"
ensure Feature C outcome
variable "featureC" is "yes"
`
		};

		const featureD = {
			path: '/features/featureD.feature',
			content: `
Feature: Feature D
ensure Shared setup
variable "shared" is "yes"
`
		};

		const result = await testWithDefaults(
			[featureC, featureD],
			[ActivitiesStepper, Haibun, VariablesSteppers],
			DEF_PROTO_OPTIONS,
			[setupBackground]
		);

		expect(result.ok).toBe(true);
	});
});

describe('outcomes between features', () => {
	it('clears outcome satisfaction between features', async () => {
		const background = {
			path: '/backgrounds/login.feature',
			content: 'waypoint Is logged in with set loggedIn to "true"',
		};

		const feature1 = {
			path: '/features/feature1.feature',
			content: 'ensure Is logged in\nvariable loggedIn is "true"'
		};

		const feature2 = {
			path: '/features/feature2.feature',
			content: 'ensure Is logged in\nvariable loggedIn is "true"'
		};

		const result = await testWithDefaults([feature1, feature2], [ActivitiesStepper, Haibun, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
	});

	it('feature-defined outcomes not available in other features', async () => {
		const feature1 = {
			path: '/features/feature1.feature',
			content: 'waypoint Feature 1 outcome with set f1 to "yes"',
		};

		const feature2 = {
			path: '/features/feature2.feature',
			content: 'ensure Feature 1 outcome',
		};

		const result = await testWithDefaults([feature1, feature2], [ActivitiesStepper, Haibun, VariablesSteppers]);

		// Feature outcome from feature1 is removed after feature1 ends, so feature2 can't use it
		expect(result.ok).toBe(false);
		expect(result.failure?.stage).toBe('Execute');
		expect(result.failure?.error.message).toContain('no step found for "Feature 1 outcome"');
	});

	it('background outcomes available in all features', async () => {
		const background = {
			path: '/backgrounds/shared.feature',
			content: 'waypoint Shared outcome with set shared to "value"',
		};

		const feature1 = {
			path: '/features/feature1.feature',
			content: 'ensure Shared outcome\nvariable shared is "value"',
		};

		const feature2 = {
			path: '/features/feature2.feature',
			content: 'ensure Shared outcome\nvariable shared is "value"',
		};

		const result = await testWithDefaults([feature1, feature2], [ActivitiesStepper, Haibun, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
	});
});

describe('multiple waypoint', () => {
	const background = {
		path: '/backgrounds/multi.feature',
		content: `Activity: Multi waypoint test
		set step1 to "1"
		waypoint First outcome with set "first" to "1"
		set step2 to "2"
		waypoint Second outcome with set "second" to "2"
		set afterstep to "done"`
	};

	it('first waypoints', async () => {
		const feature = {
			path: '/features/feature.feature',
			content: `ensure First outcome
			variable step1 is "1"
			variable first is "1"
			not variable step2 is set
			not variable second is set`,
		};

		const result = await testWithDefaults([feature], [ActivitiesStepper, Haibun, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
	});

	it('second waypoints with last statement not a waypoint', async () => {
		const feature = {
			path: '/features/feature.feature',
			content: `ensure Second outcome
			variable step1 is "1"
			variable first is "1"
			variable step2 is "2"
			variable second is "2"
			not variable afterstep is set`,
		};

		const result = await testWithDefaults([feature], [ActivitiesStepper, Haibun, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
	});
});
