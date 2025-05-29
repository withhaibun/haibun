import { describe, it, expect } from 'vitest';
import { getBackgroundFeatures } from './feature-bases.js';
import { asFeatures } from '@haibun/core/build/lib/resolver-features.js';
import { createSteppers } from '@haibun/core/build/lib/util/index.js';
import { Resolver } from '@haibun/core/build/phases/Resolver.js';
import { expand } from '@haibun/core/build/lib/features.js';
import Haibun from '@haibun/core/build/steps/haibun.js';
import { OK } from '@haibun/core/build/lib/defs.js';
import { AStepper } from '@haibun/core/build/lib/astepper.js';

class TestStepper extends AStepper {
	steps = {
		'Background step 1': {
			exact: 'Background step 1',
			action: async () => Promise.resolve(OK),
		},
		'Feature step 1': {
			exact: 'Feature step 1',
			action: async () => Promise.resolve(OK),
		},
	};
}

describe('getBackgroundFeatures', () => {
	it('extracts backgrounds from resolved features', async () => {
		const features = asFeatures([
			{ path: '/f1.feature', content: 'Backgrounds: b1\nScenario: F1\nFeature step 1' },
			{ path: '/f2.feature', content: 'Backgrounds: b2\nScenario: F2\nFeature step 1' },
		]);
		const backgrounds = asFeatures([
			{ path: '/b1.feature', content: 'Background step 1' },
			{ path: '/b2.feature', content: 'Background step 1' },
		]);
		const steppers = await createSteppers([TestStepper, Haibun]);
		const expandedFeatures = await expand({ backgrounds, features });
		const resolver = new Resolver(steppers);
		const resolvedFeatures = await resolver.resolveStepsFromFeatures(expandedFeatures);
		const result = getBackgroundFeatures(resolvedFeatures);
		expect(new Set(result)).toEqual(new Set(['/b1.feature', '/b2.feature']));
	});
});
