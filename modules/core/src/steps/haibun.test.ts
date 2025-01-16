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
		expect(res.actionResult.name).toBe('prose');
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
	it.only('process effect callbacks', async () => {
		const feature = { path: '/features/test.feature', content: 'have a test\nafter every TestSteps, passes' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		console.log('🤑', JSON.stringify(result.featureResults, null, 2));
		expect(result.featureResults![0].stepResults.length).toBe(3);
		expect(result.featureResults![0].stepResults[1].seq).toBe(1.1);
	});
});
