import { describe, it, expect } from 'vitest';
import { withAction, TActionExecutor } from './withAction.js';
import { toBdd, fromBdd } from './converter.js';
import { AStepper, TStepperSteps } from '../lib/astepper.js';
import { OK } from '../lib/defs.js';
import { ActivitiesStepper } from '../steps/activities-stepper.js';

// A mock stepper for testing purposes
class TestStepper extends AStepper {
	steps = {
		set: {
			gwta: 'set {what} to {value}',
			action: () => Promise.resolve(OK),
		},
		doSomething: {
			gwta: 'do something',
			action: () => Promise.resolve(OK),
		},
		registerOutcome: {
			gwta: 'outcome {outcome}',
			action: () => Promise.resolve(OK),
		},
		not: {
			gwta: 'not {statement}',
			action: () => Promise.resolve(OK),
		}
	} as const satisfies TStepperSteps;
}

// A stepper with optional patterns to test regex stripping
class OptionalPatternStepper extends AStepper {
	steps = {
		setOptional: {
			gwta: 'set( empty)? {what} to {value}',
			action: () => Promise.resolve(OK),
		},
		clickOptional: {
			gwta: 'click( on)? {target}',
			action: () => Promise.resolve(OK),
		},
	} as const satisfies TStepperSteps;
}

class ProseStepper extends AStepper {
	steps = {
		prose: {
			gwta: 'prose: {prose}',
			action: () => Promise.resolve(OK),
		}
	}
}

const testStepper = new TestStepper();
const optionalPatternStepper = new OptionalPatternStepper();
const proseStepper = new ProseStepper();
const activitiesStepper = new ActivitiesStepper();

const steppers = [testStepper, proseStepper, activitiesStepper] as const;

describe('withAction', () => {
	const { set, doSomething, registerOutcome, not } = withAction(testStepper);
	const { prose } = withAction(proseStepper);
	const { activity, ensure, } = withAction(activitiesStepper);

	it('should generate curried functions for each step', () => {
		expect([set, doSomething, registerOutcome, not, prose, activity, ensure, ].every(a => typeof a === 'function')).toBe(true);
	});

	it('should throw an error if a required argument is missing', () => {
		const unsafeSet = set as unknown as (args: Record<string, string>) => ReturnType<typeof set>;
		expect(() => unsafeSet({ what: 'sound' })).toThrow('Missing argument "value" for action "set"');
	});

	it('should enforce compile-time argument names', () => {
		if (false as boolean) {
			// @ts-expect-error set only accepts { what, value }
			set({ nosuchthing: 'wobbly' });
		}
	});

	it('should return an action executor', () => {
		const executor = set({ what: 'sound', value: 'moo' });
		expect(typeof executor).toBe('function');
		const action = executor();
		expect(action.actionName).toBe('set');
		expect(action.args).toEqual({ what: 'sound', value: 'moo' });
		expect(action.gwta).toBe('set sound to moo');
	});

	it('should handle steps with no arguments', () => {
		const executor = doSomething({});
		const action = executor();
		expect(action.actionName).toBe('doSomething');
		expect(action.gwta).toBe('do something');
	});

	it('should handle the "not" step generically', () => {
		const executor = not({ statement: 'ensure an outcome' });
		const action = executor();
		expect(action.actionName).toBe('not');
		expect(action.gwta).toBe('not ensure an outcome');
	});

	it('should allow nested executors in statement arguments', () => {
		const boobar = set({ what: 'boo', value: 'bar' })
		const nnestedExecutor = not({ statement: not({ statement: boobar }) });
		const action = nnestedExecutor();
		expect(action.args).toEqual({ statement: 'not set boo to bar' });
		expect(action.gwta).toBe('not not set boo to bar');
	});

	it('should handle ensure', () => {
		const executor = ensure({ outcome: 'Activity: deploy release v1.2.0' });
		const action = executor();
		expect(action.actionName).toBe('ensure');
		expect(action.gwta).toBe('ensure Activity: deploy release v1.2.0');
	});	it('should handle the "prose" step generically', () => {
		const executor = prose({ prose: 'this is a test' });
		const action = executor();
		expect(action.actionName).toBe('prose');
		expect(action.gwta).toBe('prose: this is a test');
	});

	it('should handle registerOutcome', () => {
		const executor = registerOutcome({ outcome: 'test outcome' });
		const action = executor();
		expect(action.actionName).toBe('registerOutcome');
		expect(action.gwta).toBe('outcome test outcome');
	});

	it('should handle ensure', () => {
		const executor = ensure({ outcome: 'Activity: deploy release v1.2.0' });
		const action = executor();
		expect(action.actionName).toBe('ensure');
		expect(action.gwta).toBe('ensure Activity: deploy release v1.2.0');
	});
});

describe('withAction with optional patterns', () => {
	const { setOptional, clickOptional } = withAction(optionalPatternStepper);

	it('should handle steps with optional patterns - extracting correct arguments', () => {
		const executor = setOptional({ what: 'value', value: 'test' });
		expect(typeof executor).toBe('function');
		const action = executor();
		expect(action.actionName).toBe('setOptional');
		expect(action.args).toEqual({ what: 'value', value: 'test' });
		// Optional pattern '( empty)?' should be stripped from output
		expect(action.gwta).toBe('set value to test');
	});

	it('should handle steps with optional patterns - single argument', () => {
		const executor = clickOptional({ target: 'Submit Button' });
		const action = executor();
		expect(action.actionName).toBe('clickOptional');
		expect(action.args).toEqual({ target: 'Submit Button' });
		// Optional pattern '( on)?' should be stripped from output
		expect(action.gwta).toBe('click Submit Button');
	});

	it('should enforce correct types even with optional patterns', () => {
		if (false as boolean) {
			// @ts-expect-error setOptional should only accept { what, value }
			setOptional({ what: 'test' }); // missing value
			// @ts-expect-error setOptional should only accept { what, value }
			setOptional({ value: 'test' }); // missing what
			// @ts-expect-error setOptional should only accept { what, value }
			setOptional({ what: 'test', value: 'test', extra: 'field' });
		}
	});
});

describe('toBdd', () => {
	const { set, doSomething } = withAction(testStepper);

	it('should convert a kireji feature to a BDD string', () => {
		const feature = {
			'my feature': [
				set({ what: 'sound', value: 'moo' }),
				doSomething({}),
			],
		};
		const expectedBdd = `Feature: my feature
  set sound to moo
  do something
`;
		expect(toBdd(feature)).toBe(expectedBdd);
	});

	it('should convert a kireji feature with prose strings to BDD', () => {
		const feature = {
			'feature with prose': [
				'This is a prose step explaining the feature.',
				set({ what: 'sound', value: 'moo' }),
				'Another prose step for documentation.',
				doSomething({}),
				'Final prose step.',
			],
		};
		const expectedBdd = `Feature: feature with prose
  This is a prose step explaining the feature.
  set sound to moo
  Another prose step for documentation.
  do something
  Final prose step.
`;
		expect(toBdd(feature)).toBe(expectedBdd);
	});
});

describe('fromBdd', () => {
	it('should convert a BDD string to a kireji feature', async () => {
		const bdd = `Feature: my feature
  set sound to moo
  do something
	not set sound to cow
  prose: this is a test
`;
		const feature = await fromBdd(bdd, [...steppers]);
		const results = feature['my feature']
			.filter((step): step is TActionExecutor<string> => typeof step !== 'string')
			.map(executor => executor());
		expect(results).toEqual([
			{ actionName: 'set', args: { what: 'sound', value: 'moo' }, gwta: 'set sound to moo' },
			{ actionName: 'doSomething', args: {}, gwta: 'do something' },
			{
				"actionName": "not",
				"args": {
					"statement": "set sound to cow",
				},
				"gwta": "not set sound to cow",
			},

			{ actionName: 'prose', args: { prose: 'this is a test' }, gwta: 'prose: this is a test' },
		]);
		expect(lineTrimmed(toBdd(feature))).toBe(lineTrimmed(bdd));
	});

	it('should convert a complex activities and outcomes feature', async () => {
		const { set, not, doSomething } = withAction(testStepper);
		const { prose } = withAction(proseStepper);
		const { activity, ensure, } = withAction(activitiesStepper);

		if (false as boolean) {
			// @ts-expect-error ensure only accepts { outcome }
			ensure({ basket: 'Activity: deploy release v1.2.0' });
		}
		const feature = {
			'Complex activities and outcomes': [
				activity({ activity: 'prepare environment for staging' }),
				set({ what: 'plan', value: 'database migration' }),
				activity({ activity: 'deploy release v1.2.0' }),
				ensure({ outcome: 'Activity: deploy release v1.2.0' }),
				not({ statement: 'Activity: deploy release v1.2.0' }),
				activity({ activity: 'validate metrics for staging' }),
				prose({ prose: 'outcomes orchestrate multi-step activities' }),
				doSomething({}),
			],
		};
		const bdd = toBdd(feature);
		expect(lineTrimmed(bdd)).toBe(lineTrimmed(`Feature: Complex activities and outcomes
		  Activity: prepare environment for staging
		  set plan to database migration
		  Activity: deploy release v1.2.0
		  ensure Activity: deploy release v1.2.0
		  not Activity: deploy release v1.2.0
		  Activity: validate metrics for staging
		  prose: outcomes orchestrate multi-step activities
		  do something
		`));
		const featureFromBdd = await fromBdd(bdd, [...steppers]);
		const results = featureFromBdd['Complex activities and outcomes']
			.filter((step): step is TActionExecutor<string> => typeof step !== 'string')
			.map(executor => executor());
		expect(results).toEqual([
			{ actionName: 'activity', args: { activity: 'prepare environment for staging' }, gwta: 'Activity: prepare environment for staging' },
			{ actionName: 'set', args: { what: 'plan', value: 'database migration' }, gwta: 'set plan to database migration' },
			{ actionName: 'activity', args: { activity: 'deploy release v1.2.0' }, gwta: 'Activity: deploy release v1.2.0' },
			{ actionName: 'ensure', args: { outcome: 'Activity: deploy release v1.2.0' }, gwta: 'ensure Activity: deploy release v1.2.0' },
			{ actionName: 'not', args: { statement: 'Activity: deploy release v1.2.0' }, gwta: 'not Activity: deploy release v1.2.0' },
			{ actionName: 'activity', args: { activity: 'validate metrics for staging' }, gwta: 'Activity: validate metrics for staging' },
			{ actionName: 'prose', args: { prose: 'outcomes orchestrate multi-step activities' }, gwta: 'prose: outcomes orchestrate multi-step activities' },
			{ actionName: 'doSomething', args: {}, gwta: 'do something' },
		]);
		expect(lineTrimmed(toBdd(featureFromBdd))).toBe(lineTrimmed(bdd));
	});
});

const lineTrimmed = (s: string) => s.split('\n').map(l => l.trim()).join('\n');
