import { describe, it, expect } from 'vitest';

import { FeatureExecutor } from '../phases/Executor.js';
import { DEF_PROTO_OPTIONS, getDefaultWorld, testWithDefaults } from '../lib/test/lib.js';
import TestSteps from '../lib/test/TestSteps.js';
import Haibun from './haibun.js';
import VariablesSteppers from './variables-stepper.js';
import { getActionableStatement } from '../phases/Resolver.js';

describe('prose', () => {
	it('finds prose', async () => {
		const world = getDefaultWorld(0);
		const { featureStep, steppers } = getActionableStatement([new Haibun()], 'A sentence.', '/feature/test', 0);
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
		const feature = { path: '/features/test.feature', content: 'ends with OK\nIs not reached.' };
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

describe('if', () => {
	it('if when missing', async () => {
		const feature = { path: '/features/test.feature', content: 'if doesnotexist, ends with OK' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(false);
	});
	it('if what missing', async () => {
		const feature = { path: '/features/test.feature', content: 'if passes, doesnotexist' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(false);
	});
	it('if condition true', async () => {
		const feature = { path: '/features/test.feature', content: 'if passes, ends with OK' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
	});
	it('if condition false', async () => {
		const feature = { path: '/features/test.feature', content: 'if fails, ends with not OK' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
	});
	it('if condition fails', async () => {
		const feature = { path: '/features/test.feature', content: 'if passes, ends with not OK' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(false);
	});
	it('if condition condition with backgrounds', async () => {
		const feature = { path: '/features/test.feature', content: 'if passes, Backgrounds: bg' };
		const background = { path: '/backgrounds/bg.feature', content: 'set ran to true\nends with ok' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
		expect(result.world.shared.get('ran')).toBe('true')

		let i = 0;
		expect(result.featureResults![0].stepResults.length).toBe(3);
		expect(result.featureResults![0].stepResults[i++].seq).toBe(2.2);
		expect(result.featureResults![0].stepResults[i++].seq).toBe(2.3);
		expect(result.featureResults![0].stepResults[i++].seq).toBe(1);
	});
});

describe('not', () => {
	it('not what missing', async () => {
		const feature = { path: '/features/test.feature', content: 'not doesnotexist' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(false);
	});
	it('not condition true', async () => {
		const feature = { path: '/features/test.feature', content: 'not fails\nends with OK' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
	});
	it('not condition false', async () => {
		const feature = { path: '/features/test.feature', content: 'not passes\nends with not OK' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(false);
	});
	it('not with Backgrounds fails', async () => {
		const feature = { path: '/features/test.feature', content: 'not Backgrounds: bg' };
		const background = { path: '/backgrounds/bg.feature', content: 'fails' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
	});
	it('not with Backgrounds passes', async () => {
		const feature = { path: '/features/test.feature', content: 'not Backgrounds: bg' };
		const background = { path: '/backgrounds/bg.feature', content: 'passes' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(false);
	});
});

describe('if not', () => {
	it('if not condition true', async () => {
		const feature = { path: '/features/test.feature', content: 'if not fails, ends with OK' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
	});
	it('if not condition false', async () => {
		const feature = { path: '/features/test.feature', content: 'if not passes, ends with not OK' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
	});
	it('if not condition fails', async () => {
		const feature = { path: '/features/test.feature', content: 'if not fails, ends with not OK' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(false);
	});
	it('if not with Backgrounds', async () => {
		const feature = { path: '/features/test.feature', content: 'if not fails, Backgrounds: bg' };
		const background = { path: '/backgrounds/bg.feature', content: 'passes' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
		expect(result.world.shared.get('ran')).toBeUndefined();
	});
});

describe('not not', () => {
	it('not not passes', async () => {
		const feature = { path: '/features/test.feature', content: 'not not passes' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
	});
	it('not not fails', async () => {
		const feature = { path: '/features/test.feature', content: 'not not fails' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(false);
	});
});
