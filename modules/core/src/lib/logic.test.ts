import { describe, it, expect } from 'vitest';
import { testWithDefaults } from './test/lib.js';
import Haibun from '../steps/haibun.js';
import VariablesSteppers from '../steps/variables-stepper.js';
import ActivitiesStepper from '../steps/activities-stepper.js';
import { DEF_PROTO_OPTIONS } from './test/lib.js';

describe('Logic system - dependency-based execution (remember/ensure/forget)', () => {
  it('should only execute the requested Activity from multiple in one background', async () => {
		// Background file with multiple Activities - only one should execute
		const multipleOutcomes = {
			path: '/backgrounds/outcomes.feature',
			content: `
Activity: Login as admin
remember Is logged in as admin with set "loginType" to "admin"

Activity: Login as user
remember Is logged in as user with set "loginType" to "user"

Activity: Login as guest
remember Is logged in as guest with set "loginType" to "guest"
`
		};

		// Main test - only uses the "user" login
		const mainFeature = {
			path: '/features/tests/main.feature',
			content: `
Feature: Multi-outcome test
Scenario: Use only one outcome
ensure Is logged in as user
variable "loginType" is "user"
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
remember Is logged in as {user} with set "loggedIn" to "true"
`
		};

		const createWidgetRecipe = {
			path: '/backgrounds/create-widget-recipe.feature',
			content: `
Activity: Create widget
remember Created widget {widgetName} that is {width} by {height} with set "widgetCreated" to "true"
`
		};

		const deleteWidgetRecipe = {
			path: '/backgrounds/delete-widget-recipe.feature',
			content: `
Activity: Delete widget
remember Deleted widget {widgetName} with set "widgetDeleted" to "true"
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
variable "loggedIn" is "true"
variable "widgetCreated" is "true"
variable "widgetDeleted" is "true"
`
		};

		const result = await testWithDefaults(
			[mainFeature],
			[ActivitiesStepper, Haibun, VariablesSteppers],
			DEF_PROTO_OPTIONS,
			[loginRecipe, createWidgetRecipe, deleteWidgetRecipe]
		);

		if (!result.ok) {
			console.log('============ TEST FAILED ============');
			console.log('OK:', result.ok);
			if (result.failure) {
				console.log('Top-level failure:', result.failure.stage, '-', result.failure.error.message);
			}
			if (result.featureResults) {
				result.featureResults.forEach((fr, i) => {
					console.log(`\nFeature ${i} (${fr.path}): ok=${fr.ok}`);
					if (!fr.ok) {
						if (fr.failure) {
							console.log(`  Failure message: ${fr.failure.message}`);
						}
						// Show failed steps
						const failedSteps = fr.stepResults.filter(sr => !sr.ok);
						console.log(`  Failed ${failedSteps.length} of ${fr.stepResults.length} steps`);
						failedSteps.slice(0, 2).forEach((step, si) => {
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							const msg = (step.stepActionResult as any).message || 'no message';
							console.log(`    Step ${si} ("${step.in}"): ${msg}`);
						});
					}
				});
			}
			console.log('\n====================================');
		}

		expect(result.ok).toBe(true);
	});

	it('should memoize conditions (not re-execute if already satisfied)', async () => {
		const loginRecipe = {
			path: '/backgrounds/login-recipe.feature',
			content: `Activity: Login
remember Is logged in as {user} with set "loggedIn" to "true"`
		};

		const mainFeature = {
			path: '/features/tests/main.feature',
			content: `
Feature: Multiple Ensures Test
Scenario: Use same condition twice
ensure Is logged in as "Admin"
ensure Is logged in as "Admin"
variable "loggedIn" is "true"
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
remember Is logged in as {user} with set "loggedIn" to "true"`
		};

		const mainFeature = {
			path: '/features/tests/main.feature',
			content: `
Feature: Login/Logout Test
Scenario: Login, logout, login again
ensure Is logged in as "Admin"
variable "loggedIn" is "true"
forget Is logged in as "Admin"
set "loggedIn" to "false"
ensure Is logged in as "Admin"
variable "loggedIn" is "true"
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

	it('should automatically forget when using "forgets" clause', async () => {
		const loginRecipe = {
			path: '/backgrounds/login-recipe.feature',
			content: `Activity: Login
remember Is logged in as {user} with set "loggedIn" to "true"`
		};

		const logoutRecipe = {
			path: '/backgrounds/logout-recipe.feature',
			content: `Activity: Logout
remember Is logged out as {user} with set "loggedIn" to "false" forgets Is logged in as {user}`
		};

		const mainFeature = {
			path: '/features/tests/main.feature',
			content: `
Feature: Login/Logout/Login Test
Scenario: Auto-forget via forgets clause
ensure Is logged in as "Admin"
variable "loggedIn" is "true"
ensure Is logged out as "Admin"
variable "loggedIn" is "false"
ensure Is logged in as "Admin"
variable "loggedIn" is "true"
`
		};

		const result = await testWithDefaults(
			[mainFeature],
			[ActivitiesStepper, Haibun, VariablesSteppers],
			DEF_PROTO_OPTIONS,
			[loginRecipe, logoutRecipe]
		);

		expect(result.ok).toBe(true);
	});

	it('should handle multiple variable bindings correctly', async () => {
		const loginRecipe = {
			path: '/backgrounds/login-recipe.feature',
			content: `Activity: Login tracking
remember Is logged in as {user} with set "lastUser" to {user}`
		};

		const mainFeature = {
			path: '/features/tests/main.feature',
			content: `
Feature: Multi-user Test
Scenario: Different users can log in
ensure Is logged in as "Alice"
variable "lastUser" is "Alice"
ensure Is logged in as "Bob"
variable "lastUser" is "Bob"
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

	it('should handle complex forgets with multiple variables', async () => {
		const createRecipe = {
			path: '/backgrounds/create-recipe.feature',
			content: `Activity: Create item
remember Created {item} with set "created" to {item}`
		};

		const deleteRecipe = {
			path: '/backgrounds/delete-recipe.feature',
			content: `Activity: Delete item
remember Deleted {item} with set "deleted" to {item} forgets Created {item}`
		};

		const mainFeature = {
			path: '/features/tests/main.feature',
			content: `
Feature: Create/Delete Test
Scenario: Ensure re-creation after deletion
ensure Created "Widget1"
variable "created" is "Widget1"
ensure Deleted "Widget1"
variable "deleted" is "Widget1"
set "created" to "not Widget1"
ensure Created "Widget1"
variable "created" is "Widget1"
`
		};

		const result = await testWithDefaults(
			[mainFeature],
			[ActivitiesStepper, Haibun, VariablesSteppers],
			DEF_PROTO_OPTIONS,
			[createRecipe, deleteRecipe]
		);

		expect(result.ok).toBe(true);
	});

	it('outcomes from backgrounds are shared, but feature outcomes are isolated', async () => {
		const setupBackground = {
			path: '/backgrounds/setup.background',
			content: 'remember Shared setup with set "shared" to "yes"',
		};

		const featureC = {
			path: '/features/featureC.feature',
			content: `
Feature: Feature C
remember Feature C outcome with set "featureC" to "yes"
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
			path: '/backgrounds/login.background',
			content: 'remember Is logged in with set "loggedIn" to "true"',
		};

		const feature1 = {
			path: '/features/feature1.feature',
			content: 'ensure Is logged in\nvariable "loggedIn" is "true"'
		};

		const feature2 = {
			path: '/features/feature2.feature',
			content: 'ensure Is logged in\nvariable "loggedIn" is "true"'
		};

		const result = await testWithDefaults([feature1, feature2], [ActivitiesStepper, Haibun, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
	});

	it('feature-defined outcomes not available in other features', async () => {
		const feature1 = {
			path: '/features/feature1.feature',
			content: 'remember Feature 1 outcome with set "f1" to "yes"',
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
			path: '/backgrounds/shared.background',
			content: 'remember Shared outcome with set "shared" to "value"',
		};

		const feature1 = {
			path: '/features/feature1.feature',
			content: 'ensure Shared outcome\nvariable "shared" is "value"',
		};

		const feature2 = {
			path: '/features/feature2.feature',
			content: 'ensure Shared outcome\nvariable "shared" is "value"',
		};

		const result = await testWithDefaults([feature1, feature2], [ActivitiesStepper, Haibun, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
	});
});
