import { asFeatures } from './lib/resolver-features.js';
import { getDefaultWorld } from './lib/test/lib.js';
import TestSteps from './lib/test/TestSteps.js';
import { Runner } from './runner.js';
import { describe, it, expect } from 'vitest';

describe('runFeaturesAndBackgrounds', () => {
	it('should pass a basic test', async () => {
		const world = getDefaultWorld(0);
		const runner = new Runner(world);
		const features = asFeatures([{ path: '/features/test.feature', content: `passes` }]);
		const steppers = [TestSteps];
		const result = await runner.runFeaturesAndBackgrounds(steppers, { features, backgrounds: [] });
		expect(result.ok).toBe(true);
	});
	it('should fail a basic test', async () => {
		const world = getDefaultWorld(0);
		const runner = new Runner(world);
		const features = asFeatures([{ path: '/features/test.feature', content: `fails` }]);
		const steppers = [TestSteps];
		const result = await runner.runFeaturesAndBackgrounds(steppers, { features, backgrounds: [] });
		expect(result.ok).toBe(false);
	});
	it.only('should pass multiple features', async () => {
		const world = getDefaultWorld(0, { TRACE: 'true' });
		const runner = new Runner(world);
		const features = asFeatures([
			{ path: '/features/test.feature', content: `passes` },
			{ path: '/features/test.feature', content: `passes` },
		]);
		const steppers = [TestSteps];
		const result = await runner.runFeaturesAndBackgrounds(steppers, { features, backgrounds: [] });
		expect(result.ok).toBe(true);
		expect(result.featureResults?.length).toBe(2);
	});
});
