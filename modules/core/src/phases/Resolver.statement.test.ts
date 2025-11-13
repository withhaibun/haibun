import { describe, it, expect } from 'vitest';

import { AStepper } from '../lib/astepper.js';
import { OK } from '../lib/defs.js';
import { asExpandedFeatures } from '../lib/resolver-features.js';
import { Resolver } from './Resolver.js';
import { createSteppers } from '../lib/util/index.js';
import { DOMAIN_STATEMENT } from '../lib/domain-types.js';

// A test stepper that uses a statement typed placeholder
class StatementStepper extends AStepper {
	steps = {
		meta: {
			gwta: `meta {action: ${DOMAIN_STATEMENT}}`,
			action: async () => Promise.resolve(OK),
		},
		base: {
			gwta: 'base action',
			action: async () => Promise.resolve(OK),
		},
	}
}

describe('statement variable validation', () => {
	it('accepts valid statement expansion', async () => {
		const features = asExpandedFeatures([{ path: 'f1', content: 'meta base action' }]);
		const steppers = createSteppers([StatementStepper]);
		const resolver = new Resolver(steppers);
		const resolved = await resolver.resolveStepsFromFeatures(features);
		expect(resolved[0].featureSteps.length).toBe(1);
		expect(resolved[0].featureSteps[0].action.actionName).toBe('meta');
	});
	it('rejects invalid statement expansion', async () => {
		const features = asExpandedFeatures([{ path: 'f1', content: 'meta not-an-action' }]);
		const steppers = createSteppers([StatementStepper]);
		const resolver = new Resolver(steppers);
		await expect(resolver.resolveStepsFromFeatures(features)).rejects.toThrow(/statement 'not-an-action' invalid/);
	});
});

