import { describe, it, test, expect } from 'vitest';

import { OK, TExpandedFeature, TResolvedFeature } from '../lib/defs.js';
import { AStepper } from '../lib/astepper.js';
import { asExpandedFeatures } from '../lib/resolver-features.js';
import TestSteps from '../lib/test/TestSteps.js';
import { createSteppers } from '../lib/util/index.js';
import { Resolver } from './Resolver.js';

describe('resolve steps', () => {
	it('resolves steps', async () => {
		const features = asExpandedFeatures([{ path: 'l1', content: 'Then it passes' }]);
		const steppers = await createSteppers([TestSteps]);
		const resolver = new Resolver(steppers);
		const steps = await resolver.resolveStepsFromFeatures(features);
		expect(steps.length).toBe(1);
	});
});

describe('validate map steps', () => {
	class TestStepper extends AStepper {
		steps = {
			exact: {
				exact: 'exact1',
				action: async () => Promise.resolve(OK),
			},
			match: {
				match: /match(?<num>1)/,
				action: async () => Promise.resolve(OK),
			},
			gwta: {
				gwta: 'gwta(?<num>.)',
				action: async () => Promise.resolve(OK),
			},
			gwtaInterpolated: {
				gwta: 'is {what}',
				action: async () => Promise.resolve(OK),
			},
		};
	}

	const getResolvedSteps = async (features: TExpandedFeature[]) => {
		const steppers = await createSteppers([TestStepper]);
		const resolver = new Resolver(steppers);
		return await resolver.resolveStepsFromFeatures(features);
	};
	describe('exact', () => {
		test('exact', async () => {
			const features = asExpandedFeatures([{ path: 'l1', content: `exact1` }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = res[0];
			expect(featureSteps[0].action.stepValuesMap).toBeUndefined();
		});
	});
	describe('match', () => {
		test('match', async () => {
			const features = asExpandedFeatures([{ path: 'l1', content: `match1` }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = res[0];
			// regex style match still exposes no stepValuesMap for legacy direct regex usage
			expect(featureSteps[0].action.stepValuesMap).toBeUndefined();
		});
	});
	describe('gwta regex', () => {
		test('gwta', async () => {
			const features = asExpandedFeatures([
				{ path: 'l1', content: `gwta2\nGiven I'm gwta3\nWhen I am gwta4\nGwta5\nThen the gwta6` },
			]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = res[0] as TResolvedFeature;
			// gwta pattern using regex groups directly still not using stepValuesMap
			featureSteps.forEach(fs => expect(fs.action.stepValuesMap).toBeUndefined());
		});
	});
	describe('gwta interpolated', () => {
		test('gets quoted', async () => {
			const features = asExpandedFeatures([{ path: 'l1', content: 'is "string"' }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = res[0] as TResolvedFeature;
			const sv = featureSteps[0].action.stepValuesMap!['what'];
			expect(sv.term).toEqual('string');
		});
		test('gets uri', async () => {
			const features = asExpandedFeatures([{ path: 'l1', content: 'is http://url' }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = res[0] as TResolvedFeature;
			const sv = featureSteps[0].action.stepValuesMap!['what'];
			expect(sv.term).toEqual('http://url');
		});
	});
});

describe('unique stepper', () => {
	const astep = 'step';
	class UniqueStepper extends AStepper {
		steps = {
			uniqueStep: {
				unique: true,
				gwta: astep,
				action: async () => Promise.resolve(OK),
			},
			normalStep: {
				gwta: astep,
				action: async () => Promise.resolve(OK),
			},
		};
	}
	test('uses unique step when multiple match', async () => {
		const features = asExpandedFeatures([{ path: 'l1', content: astep }]);
		const steppers = await createSteppers([UniqueStepper]);
		const resolver = new Resolver(steppers);
		const steps = await resolver.resolveStepsFromFeatures(features);
		expect(steps.length).toBe(1);
		expect(steps[0].featureSteps.length).toBe(1);
		expect(steps[0].featureSteps[0].action.stepperName).toBe('UniqueStepper');
	});
});
describe('preclude stepper', () => {
	class PrecludedStepper extends AStepper {
		steps = {
			doesSomething: {
				gwta: 'does {something}',
				action: async () => Promise.resolve(OK),
			},
		}
	}
	class PrecluderStepper extends AStepper {
		steps = {
			doesSomething: {
				gwta: 'does {something} else',
				precludes: ['PrecludedStepper.doesSomething'],
				action: async () => Promise.resolve(OK),
			},
		};
	}
	test('precludes stepper', async () => {
		const features = asExpandedFeatures([{ path: 'l1', content: 'does something else' }]);
		const steppers = await createSteppers([PrecludedStepper, PrecluderStepper]);
		const resolver = new Resolver(steppers);
		const steps = await resolver.resolveStepsFromFeatures(features);
		expect(steps.length).toBe(1);
		expect(steps[0].featureSteps.length).toBe(1);
		expect(steps[0].featureSteps[0].action.stepperName).toBe('PrecluderStepper');
	});
});

