import { describe, it, test, expect } from 'vitest';

import { AStepper, OK, TExpandedFeature, TResolvedFeature } from '../lib/defs.js';
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
			const { featureSteps } = res[0] as TResolvedFeature;
			expect(featureSteps[0].action.named).toBeUndefined();
		});
	});
	describe('match', () => {
		test('match', async () => {
			const features = asExpandedFeatures([{ path: 'l1', content: `match1` }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = res[0] as TResolvedFeature;
			expect(featureSteps[0].action.named).toEqual({ num: '1' });
		});
	});
	describe('gwta regex', () => {
		test('gwta', async () => {
			const features = asExpandedFeatures([
				{ path: 'l1', content: `gwta2\nGiven I'm gwta3\nWhen I am gwta4\nGwta5\nThen the gwta6` },
			]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = res[0] as TResolvedFeature;
			expect(featureSteps[0].action.named).toEqual({ num: '2' });
			expect(featureSteps[1].action.named).toEqual({ num: '3' });
			expect(featureSteps[2].action.named).toEqual({ num: '4' });
			expect(featureSteps[3].action.named).toEqual({ num: '5' });
			expect(featureSteps[4].action.named).toEqual({ num: '6' });
		});
	});
	describe('gwta interpolated', () => {
		test('gets quoted', async () => {
			const features = asExpandedFeatures([{ path: 'l1', content: 'is "string"' }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = res[0] as TResolvedFeature;
			expect(featureSteps[0].action.named?.q_0).toEqual('string');
		});
		test('gets uri', async () => {
			const features = asExpandedFeatures([{ path: 'l1', content: 'is http://url' }]);
			const res = await getResolvedSteps(features);
			const { featureSteps } = res[0] as TResolvedFeature;
			expect(featureSteps[0].action.named?.t_0).toEqual('http://url');
		});
	});
});
