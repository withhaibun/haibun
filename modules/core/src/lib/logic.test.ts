import { describe, it, expect } from 'vitest';
import { testWithDefaults } from './test/lib.js';
import Haibun from '../steps/haibun.js';
import VariablesSteppers from '../steps/variables-stepper.js';
import ActivitiesStepper from '../steps/activities-stepper.js';
import { DEF_PROTO_OPTIONS } from './test/lib.js';

describe('Logic system - dependency-based execution (waypoint/ensure)', () => {
	it('should only execute the requested Activity from multiple in one background', async () => {
		// Background file with multiple Activities - only one should execute
		const multipleOutcomes = {
			path: '/backgrounds/outcomes.feature',
			content: `
Activity: Login as admin
set loginType to "admin"
waypoint Is logged in as admin with variable loginType is "admin"

Activity: Login as user
set loginType to "user"
waypoint Is logged in as user with variable loginType is "user"

Activity: Login as guest
set loginType to "guest"
waypoint Is logged in as guest with variable loginType is "guest"
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
set "loggedIn" to "true"
waypoint Is logged in as {user} with variable loggedIn is "true"
`
		};

		const createWidgetRecipe = {
			path: '/backgrounds/create-widget-recipe.feature',
			content: `
Activity: Create widget
set "widgetCreated" to "true"
waypoint Created widget {widgetName} that is {width} by {height} with variable widgetCreated is "true"
`
		};

		const deleteWidgetRecipe = {
			path: '/backgrounds/delete-widget-recipe.feature',
			content: `
Activity: Delete widget
set "widgetDeleted" to "true"
waypoint Deleted widget {widgetName} with variable widgetDeleted is "true"
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

	it('should handle multiple variable bindings correctly', async () => {
		const loginRecipe = {
			path: '/backgrounds/login-recipe.feature',
			content: `Activity: Login tracking
set lastUser to {user}
waypoint Is logged in as {user} with variable lastUser is {user}`
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
});

describe('outcomes between features', () => {
	it('background outcomes available in all features', async () => {
		const background = {
			path: '/backgrounds/shared.feature',
			content: `Activity: Shared setup
set shared to "value"
waypoint Shared outcome with variable shared is "value"`,
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
set first to "1"
waypoint First outcome with variable first is "1"
set step2 to "2"
set second to "2"
waypoint Second outcome with variable second is "2"
set afterstep to "done"`
	};

	it('first waypoint', async () => {
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

	it('second waypoint with last statement not a waypoint', async () => {
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
