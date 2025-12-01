import { describe, it, expect } from 'vitest';

import { DEF_PROTO_OPTIONS, failWithDefaults, passWithDefaults } from '../lib/test/lib.js';
import TestSteps from '../lib/test/TestSteps.js';
import Haibun from './haibun.js';
import VariablesSteppers from './variables-stepper.js';
import LogicStepper from './logic-stepper.js';

describe('until', () => {
	it('until passes', async () => {
		const feature = { path: '/features/test.feature', content: 'until passes' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
	});
});

describe('seqPath ordering', () => {
	// seqPath format: [featureNum, scenarioNum, ...stepPath]
	// featureNum: 1-based feature number
	// scenarioNum: 1-based scenario number (1 when no scenario declared)
	// stepPath: hierarchical step numbering with negative numbers for conditions

	it('linear steps have incremental single-element seqPath', async () => {
		const feature = { path: '/features/test.feature', content: 'passes\npasses\npasses' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		expect(seqs).toEqual([[1, 1, 1], [1, 1, 2], [1, 1, 3]]);
	});

	it('not statement', async () => {
		const feature = { path: '/features/test.feature', content: 'passes\nnot fails\nends with OK' };
		const result = await passWithDefaults([feature], [Haibun, LogicStepper, TestSteps]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		expect(seqs).toEqual([[1, 1, 1], [1, 1, 2, -1], [1, 1, 2], [1, 1, 3]]);
	});

	it('not not statement', async () => {
		const feature = { path: '/features/test.feature', content: 'passes\nnot not passes\nends with OK' };
		const result = await passWithDefaults([feature], [Haibun, LogicStepper, TestSteps]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		expect(seqs).toEqual([[1, 1, 1], [1, 1, 2, -1, -1], [1, 1, 2, -1], [1, 1, 2], [1, 1, 3]]);
	});
});

describe('afterEvery', () => {
	it('afterEvery effect injects step', async () => {
		const feature = { path: '/features/test.feature', content: 'have a test\nafter every TestSteps, Noodles, man.\npasses\npasses' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const ins = result.featureResults![0].stepResults.map(r => r.in);
		expect(ins).toEqual(['have a test', 'after every TestSteps, Noodles, man.', 'passes', 'Noodles, man.', 'passes', 'Noodles, man.']);
	});

	it('afterEvery effect injects hierarchical step with parent seqPath extended', async () => {
		const feature = { path: '/features/test.feature', content: 'have a test\nafter every TestSteps, passes\nhave a test\npasses' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		// Step [1,1,4] "passes" does not trigger afterEvery because it's the same action (prevents infinite recursion)
		expect(seqs).toEqual([[1, 1, 1], [1, 1, 2], [1, 1, 3], [1, 1, 3, 1], [1, 1, 4]]);
	});
});

describe('prose', () => {
	it('mixed prose', async () => {
		const feature = {
			path: '/features/test.feature',
			content: `Haibun prose allows mixing text descriptions with a functional test.
When I have a test
Then it passes
Prose sections are indicated by the presence of punctuation at the end of paragraphs.`,
		};
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);

		expect(result.ok).toBe(true);

		expect(result.featureResults?.length).toBe(1);
	});

	it('process effect callback', async () => {
		const feature = { path: '/features/test.feature', content: 'have a test\nafter every TestSteps, passes' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		expect(result.featureResults && result.featureResults[0].stepResults.length).toBe(2);
	});

	it('process multiple effect callbacks', async () => {
		const feature = { path: '/features/test.feature', content: 'have a test\nafter every TestSteps, passes\nhave a test' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const rfzs = result.featureResults && result.featureResults[0].stepResults;
		expect(rfzs?.length).toBe(4);
		let n = 0;
		expect(rfzs).toBeDefined();
		if (rfzs === undefined) {
			return;
		}
		expect(rfzs[n++].stepActionResult).toBeDefined(); // sanity
		expect(rfzs[0].stepActionResult).toBeDefined();
	});
});

describe('nothing', () => {
	it('nothing step does nothing and passes', async () => {
		const feature = { path: '/features/test.feature', content: '' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
	});
});

describe('ends with', () => {
	it('ends with ok', async () => {
		const feature = { path: '/features/test.feature', content: 'ends with OK\nIs not reached.' };
		const result = await passWithDefaults([feature], [Haibun]);
		expect(result.ok).toBe(true);
		expect(result.featureResults?.length).toBe(1);
	});

	it('ends with not ok', async () => {
		const feature = { path: '/features/test.feature', content: 'ends with not OK\nIs not reached.' };
		const result = await failWithDefaults([feature], [Haibun]);
		expect(result.ok).toBe(false);
		expect(result.featureResults?.length).toBe(1);
	});
})

describe('backgrounds', () => {
	it('where with Backgrounds shows condition, directive, background steps, then parent', async () => {
		const feature = { path: '/features/test.feature', content: 'where passes, Backgrounds: bg' };
		const background = { path: '/backgrounds/bg.feature', content: 'set ran to true\nends with ok' };
		const result = await passWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		// Condition uses dir=-1, body uses dir=1: condition [1,1,1,-1], background steps [1,1,1,1] and [1,1,1,2], parent [1,1,1]
		expect(seqs).toEqual([[1, 1, 1, -1], [1, 1, 1, 1], [1, 1, 1, 2], [1, 1, 1]]);
	});

	it('not with Backgrounds fails', async () => {
		const feature = { path: '/features/test.feature', content: 'not Backgrounds: bg' };
		const background = { path: '/backgrounds/bg.feature', content: 'fails' };
		const result = await passWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
	});

	it('not with Backgrounds passes', async () => {
		const feature = { path: '/features/test.feature', content: 'not Backgrounds: bg' };
		const background = { path: '/backgrounds/bg.feature', content: 'passes' };
		const result = await failWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(false);
	});

	it('simple Backgrounds fails during Expand', async () => {
		const feature = { path: '/features/test.feature', content: 'Backgrounds: missing' };
		const result = await failWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, []);
		expect(result.ok).toBe(false);
		expect(result.failure?.stage).toBe('Expand');
		expect(result.failure?.error.message).toMatch(/can't find single "missing.feature"/);
	});

	it('not invalid Backgrounds fails during Resolve', async () => {
		const feature = { path: '/features/test.feature', content: 'not Backgrounds: nowhere' };
		const result = await failWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, []);
		expect(result.ok).toBe(false);
		expect(result.failure?.stage).toBe('Resolve');
		expect(result.failure?.error.message).toMatch(/can't find single "nowhere.feature"/);
	});

	it('background steps have correct file path', async () => {
		const feature = { path: '/features/test.feature', content: 'set ran to "false"\nwhere variable "ran" is "false", Backgrounds: bg' };
		const background = { path: '/backgrounds/bg.feature', content: 'set ran to "true"\nends with ok' };
		const result = await passWithDefaults([feature], [Haibun, LogicStepper, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);

		const paths = result.featureResults![0].stepResults.map(r => r.path);
		expect(paths).toEqual([
			'/features/test.feature',  // set ran
			'/features/test.feature',  // condition
			'/backgrounds/bg.feature',  // background step
			'/backgrounds/bg.feature',  // background step
			'/features/test.feature'    // parent where
		]);
	});
});
