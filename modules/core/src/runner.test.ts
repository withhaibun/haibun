import TestSteps from './lib/test/TestSteps.js';
import Haibun from './steps/haibun.js'
import Vars from './steps/vars.js'
import { asFeatures } from './lib/resolver-features.js';
import { getDefaultWorld } from './lib/test/lib.js';
import { Runner } from './runner.js';
import { describe, it, expect } from 'vitest';

describe('runFeaturesAndBackgrounds', () => {
	it('should pass a basic test', async () => {
		const world = getDefaultWorld(0, { HAIBUN_LOG_LEVEL: 'debug' });
		const runner = new Runner(world);
		const features = asFeatures([{ path: '/features/test.feature', content: `passes` }]);
		const steppers = [TestSteps];
		const result = await runner.runFeaturesAndBackgrounds(steppers, { features, backgrounds: [] });
		expect(result.ok).toBe(true);
	});
	it('should fail a basic test', async () => {
		const world = getDefaultWorld(0, { HAIBUN_LOG_LEVEL: 'debug' });
		const runner = new Runner(world);
		const features = asFeatures([{ path: '/features/test.feature', content: `fails` }]);
		const steppers = [TestSteps];
		const result = await runner.runFeaturesAndBackgrounds(steppers, { features, backgrounds: [] });
		expect(result.ok).toBe(false);
	});
});

describe.only('encapsulation', () => {
	it('should encapsulate background variables to each scenario', async () => {
		const world = getDefaultWorld(0, { HAIBUN_LOG_LEVEL: 'debug' });
		const runner = new Runner(world);
		const backgrounds = asFeatures([{
			path: 'backgrounds/bg.feature',
			content: `set a to 0`
		}]);
		const features = asFeatures([{
			path: 'test.feature',
			content: `
Scenario: Scenario 1
Backgrounds: bg
set a to 1

Scenario: Scenario 2
Backgrounds: bg
variable "a" is "0"
`
		}]);
		const steppers = [TestSteps, Haibun, Vars];
		const result = await runner.runFeaturesAndBackgrounds(steppers, { features, backgrounds });
		expect(result.ok).toBe(true);
	});
});
