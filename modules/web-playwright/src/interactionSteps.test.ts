import { describe, it, expect } from 'vitest';

import { createSteppers } from '@haibun/core/lib/util/index.js';
import { Resolver } from '@haibun/core/phases/Resolver.js';
import { asExpandedFeatures } from '@haibun/core/lib/resolver-features.js';
import WebPlaywright from './web-playwright.js';

describe('click', () => {
	it('click', async () => {
		const features = asExpandedFeatures([{ path: 'l1', content: 'click Foo' }]);
		const steppers = await createSteppers([WebPlaywright]);
		const resolver = new Resolver(steppers);
		const steps = await resolver.resolveStepsFromFeatures(features);
		expect(steps[0].featureSteps[0].action.actionName).toBe('click');
	});
});
describe('clickBy', () => {
	it('clickBy placeholder', async () => {
		const features = asExpandedFeatures([{ path: 'l1', content: 'click Search authorities by placeholder' }]);
		const steppers = await createSteppers([WebPlaywright]);
		const resolver = new Resolver(steppers);
		const steps = await resolver.resolveStepsFromFeatures(features);
		expect(steps[0].featureSteps[0].action.actionName).toBe('clickBy');
	});
});