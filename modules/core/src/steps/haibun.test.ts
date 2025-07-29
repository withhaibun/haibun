import { describe, it, expect } from 'vitest';

import { FeatureExecutor } from '../phases/Executor.js';
import { getDefaultWorld, testWithDefaults } from '../lib/test/lib.js';
import TestSteps from '../lib/test/TestSteps.js';
import Haibun from './haibun.js';
import { getActionableStatement } from '../phases/Resolver.js';

describe('prose', () => {
	it('finds prose', async () => {
		const world = getDefaultWorld(0);
		const { featureStep, steppers } = getActionableStatement([new Haibun()], 'A sentence.', '/feature/test');
		const res = await FeatureExecutor.doFeatureStep(steppers, featureStep, world);

		expect(res.ok).toBe(true);
		expect(res.stepActionResult.name).toBe('prose');
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
	it('process effect callback', async () => {
		const feature = { path: '/features/test.feature', content: 'have a test\nafter every TestSteps, passes' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		expect(result.featureResults && result.featureResults[0].stepResults.length).toBe(2);
	});
	it('process multiple effect callbacks', async () => {
		const feature = { path: '/features/test.feature', content: 'have a test\nafter every TestSteps, passes\nhave a test' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const rfzs = result.featureResults && result.featureResults[0].stepResults;
		expect(rfzs?.length).toBe(4);
		let n = 0;
		expect(rfzs).toBeDefined();
		if (rfzs === undefined) {
			return;
		}
		expect(rfzs[n++].seq).toBe(1);
		expect(rfzs[n++].seq).toBe(2);
		expect(rfzs[n++].seq).toBe(3);
		expect(rfzs[n++].seq).toBe(3.1);
	});
});

describe('ends with', () => {
	it('ends with ok', async () => {
		const feature = { path: '/features/test.feature', content: 'ends with OK\nDIs not reached.' };
		const result = await testWithDefaults([feature], [Haibun]);
		expect(result.ok).toBe(true);
		expect(result.featureResults?.length).toBe(1);
	});
	it('ends with not ok', async () => {
		const feature = { path: '/features/test.feature', content: 'ends with not OK\nIs not reached.' };
		const result = await testWithDefaults([feature], [Haibun]);
		expect(result.ok).toBe(false);
		expect(result.featureResults?.length).toBe(1);
	});
})
