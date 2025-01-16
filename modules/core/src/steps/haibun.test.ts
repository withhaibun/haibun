import { describe, it, expect } from 'vitest';

import { FeatureExecutor } from '../phases/Executor.js';
import { getDefaultWorld, getTestEnv, testWithDefaults } from '../lib/test/lib.js';
import TestSteps from '../lib/test/TestSteps.js';
import Haibun from './haibun.js';

describe('prose', () => {
	it('finds prose', async () => {
		const { world, vstep, steppers } = await getTestEnv(['haibun'], 'A sentence.', getDefaultWorld(0).world);
		const res = await FeatureExecutor.doFeatureStep(steppers, vstep, world);

		expect(res.ok).toBe(true);
		expect(res.actionResults[0].name).toBe('prose');
	});
	it('mixed prose', async () => {
		const feature = {
			path: '/features/test.feature',
			content: `Haibun prose allows mixing text descriptions with a functional test.
When I have a test
Then it passes
Prose sections are indicated by the presence of punctuation at the end of paragraphs.`,
		};
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);

		expect(result.ok).toBe(true);

		expect(result.featureResults?.length).toBe(1);
	});
	it.only('process resolve callbacks', async () => {
		const feature = { path: '/features/test.feature', content: 'passes\nafter every TestSteps, passes\nhave a test' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		expect(result.featureResults?.length).toBe(4);
	});
});
