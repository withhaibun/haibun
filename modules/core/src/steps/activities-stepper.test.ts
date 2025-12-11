import { describe, it, expect } from 'vitest';

import { ActivitiesStepper } from './activities-stepper.js';
import { getDefaultWorld, passWithDefaults } from '../lib/test/lib.js';
import VariablesStepper from './variables-stepper.js';

describe('ActivitiesStepper', () => {
	describe('registerOutcome', () => {
		it('should register an outcome and create a gwta step', async () => {
			const stepper = new ActivitiesStepper();
			await stepper.setWorld(getDefaultWorld(0), []);

			stepper.registerOutcome(
				'Is logged in as {user}',
				['set loggedIn to "true"'],
				'/test.feature'
			);

			const step = stepper.steps['Is logged in as {user}'];
			expect(step).toBeDefined();
			expect(step.gwta).toBe('Is logged in as {user}');
			expect(step.description).toContain('Is logged in as {user}');
			expect(step.action).toBeDefined();
			expect(typeof step.action).toBe('function');
		});

		it('should prevent duplicate outcome registration', async () => {
			const stepper = new ActivitiesStepper();
			await stepper.setWorld(getDefaultWorld(0), []);

			stepper.registerOutcome(
				'Is logged in as {user}',
				['set loggedIn to "true"'],
				'/test.feature'
			);

			expect(() => {
				stepper.registerOutcome(
					'Is logged in as {user}',
					['set loggedIn to "false"'],
					'/test.feature'
				);
			}).toThrow(/already registered/);
		});

		it('should register multiple different outcomes', async () => {
			const stepper = new ActivitiesStepper();
			await stepper.setWorld(getDefaultWorld(0), []);

			stepper.registerOutcome('Outcome A', ['step 1'], '/test.feature');
			stepper.registerOutcome('Outcome B', ['step 2'], '/test.feature');
			stepper.registerOutcome('Outcome C {x}', ['step 3'], '/test.feature');

			expect(stepper.steps['Outcome A']).toBeDefined();
			expect(stepper.steps['Outcome B']).toBeDefined();
			expect(stepper.steps['Outcome C {x}']).toBeDefined();
		});

		it('should store proof statements and path in the action closure', async () => {
			const stepper = new ActivitiesStepper();
			await stepper.setWorld(getDefaultWorld(0), []);
			const proofStatements = ['set x to "1"', 'set y to "2"'];
			const proofPath = '/backgrounds/test.feature';

			stepper.registerOutcome('Test outcome', proofStatements, proofPath);

			const step = stepper.steps['Test outcome'];
			expect(step).toBeDefined();
			expect(step.gwta).toBe('Test outcome');
		});


		it('should support multi-line proof statements', async () => {
			const stepper = new ActivitiesStepper();
			await stepper.setWorld(getDefaultWorld(0), []);

			const multiLineProof = [
				'set url to "https://example.com"',
				'set page to "home"',
				'compose fullUrl with {url}{page}',
				'go to the fullUrl webpage'
			];

			stepper.registerOutcome('Navigate to home', multiLineProof, '/test.feature');

			const step = stepper.steps['Navigate to home'];
			expect(step).toBeDefined();
			expect(step.gwta).toBe('Navigate to home');
			expect(step.description).toContain('Navigate to home');
			// The description should contain all the proof statements
			multiLineProof.forEach(proofStep => {
				expect(step.description).toContain(proofStep);
			});
		});
	});

	describe('steps initialization', () => {
		it('should start with built-in steps (activity, ensure)', () => {
			const stepper = new ActivitiesStepper();
			expect(Object.keys(stepper.steps)).toContain('activity');
			expect(Object.keys(stepper.steps)).toContain('ensure');
		});
	});

	describe('ensure step', () => {
		const steppers = [VariablesStepper, ActivitiesStepper];

		it('should execute outcome on first ensure', async () => {
			const background = {
				path: '/backgrounds/test.feature',
				content: `Activity: Test
waypoint Task completed with set result to "done"`
			};

			const feature = {
				path: '/features/test.feature',
				content: `set result to "initial"
ensure Task completed
variable result is "done"`
			};

			const result = await passWithDefaults([feature], steppers, undefined, [background]);
			expect(result.ok).toBe(true);
		});
	});
});
