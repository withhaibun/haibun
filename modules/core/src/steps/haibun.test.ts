import { describe, it, expect } from 'vitest';

import { FeatureExecutor } from '../phases/Executor.js';
import { DEF_PROTO_OPTIONS, getDefaultWorld, testWithDefaults } from '../lib/test/lib.js';
import TestSteps from '../lib/test/TestSteps.js';
import Haibun from './haibun.js';
import VariablesSteppers from './variables-stepper.js';
import { getActionableStatement } from '../phases/Resolver.js';

describe('seqPath ordering', () => {
	it('getActionableStatement custom sub-seq produces two-element seqPath', async () => {
		const world = getDefaultWorld(0);
		const { featureStep, steppers } = getActionableStatement([new Haibun(), new TestSteps()], 'passes', '/feature/test', 5, 7);
		const res = await FeatureExecutor.doFeatureStep(steppers, featureStep, world);
		expect(res.ok).toBe(true);
		expect(res.seqPath).toEqual([5, 7]);
	});
	it('linear steps have incremental single-element seqPath', async () => {
		const feature = { path: '/features/test.feature', content: 'passes\npasses\npasses' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		expect(seqs).toEqual([[1], [2], [3]]);
	});
	it('afterEvery effect injects hierarchical child with parent seqPath extended', async () => {
		const feature = { path: '/features/test.feature', content: 'have a test\nafter every TestSteps, passes\nhave a test\npasses' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		expect(seqs).toEqual([[1], [2], [3], [3, 1], [4], [4, 1]]);
	});
	it('if with Backgrounds shows condition, directive, background steps, then parent', async () => {
		const feature = { path: '/features/test.feature', content: 'if passes, Backgrounds: bg' };
		const background = { path: '/backgrounds/bg.feature', content: 'set ran to true\nends with ok' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		expect(seqs).toEqual([[1, 2], [1, 3], [1]]);
	});
	it('not statement', async () => {
		const feature = { path: '/features/test.feature', content: 'passes\nnot fails\nends with OK' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		expect(seqs).toEqual([[1], [2, 1], [2], [3]]);
	});
	it('not not statement', async () => {
		const feature = { path: '/features/test.feature', content: 'passes\nnot not passes\nends with OK' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		expect(seqs).toEqual([[1], [2, 1, 1], [2, 1], [2], [3]]);
	});
});

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
		expect(rfzs[n++].stepActionResult).toBeDefined(); // sanity
		expect(rfzs[0].stepActionResult).toBeDefined();
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
	it('if condition condition with backgrounds', async () => {
		const feature = { path: '/features/test.feature', content: 'if passes, Backgrounds: bg' };
		const background = { path: '/backgrounds/bg.feature', content: 'set ran to true\nends with ok' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
		expect(result.world.shared.get('ran')).toBe('true')

		const steps = result.featureResults![0].stepResults;
		// Simplified recording: background steps then parent if
		expect(steps.length).toBe(3);
		const seqs = steps.map(s => s.seqPath);
		expect(seqs).toEqual([[1, 2], [1, 3], [1]]);
	});
});

describe('not', () => {
	it('not what missing', async () => {
		const feature = { path: '/features/test.feature', content: 'not doesnotexist' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(false);
	});
	it.only('not condition true', async () => {
		const feature = { path: '/features/test.feature', content: 'not fails\nends with OK' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		console.log('🤑', JSON.stringify(result.featureResults, null, 2));
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


describe('compound', () => {
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
	it('not not not invalid', async () => {
		const feature = { path: '/features/test.feature', content: 'not not who\'s there' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(false);
	});
	it('not if passes, fails', async () => {
		const feature = { path: '/features/test.feature', content: 'not if passes, fails' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
	});
	it('if not passes, fails', async () => {
		const feature = { path: '/features/test.feature', content: 'if not passes, fails' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
	});
});

describe('variable composition', () => {
	it('not variable unset is set passes', async () => {
		const feature = { path: '/features/test.feature', content: 'not variable "unset" is set' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		// nested variable check then parent not then ends with
		expect(seqs).toEqual([[1, 1], [1]]);
	});
	it('not variable set is set fails', async () => {
		const feature = { path: '/features/test.feature', content: 'set wtw to 5\nnot variable "wtw" is set' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers]);
		expect(result.ok).toBe(false); // inner isSet passes so not fails
	});
	it('if not variable unset executes body', async () => {
		const feature = { path: '/features/test.feature', content: 'if not variable "fresh" is set, set fresh to 1\nvariable "fresh" is "1"' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers]);
		expect(result.ok).toBe(true);
		expect(result.world.shared.get('fresh')).toBe('1');
	});
	it('if not variable set skips body', async () => {
		const feature = { path: '/features/test.feature', content: 'set existing to 2\nif not variable "existing" is set, set existing to 3\nvariable "existing" is "2"' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers]);
		expect(result.ok).toBe(true);
		expect(result.world.shared.get('existing')).toBe('2');
	});
	it('if not variable set skips failing body', async () => {
		const feature = { path: '/features/test.feature', content: 'set existing to 2\nif not variable "existing" is set, fails' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers]);
		expect(result.ok).toBe(true); // condition false, body skipped
	});
	it('not if variable set, passes (body passes so not fails)', async () => {
		const feature = { path: '/features/test.feature', content: 'set a to 1\nnot if variable "a" is set, passes' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers]);
		expect(result.ok).toBe(false); // inner if ok -> not fails
	});
	it('not if variable unset, passes (condition false so if ok then not fails)', async () => {
		const feature = { path: '/features/test.feature', content: 'not if variable "ghost" is set, passes' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers]);
		expect(result.ok).toBe(false); // inner if ok (skipped) -> not fails
	});
	it('not if variable set, failing body (if body fails so not passes)', async () => {
		const feature = { path: '/features/test.feature', content: 'set a to 1\nnot if variable "a" is set, fails' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers]);
		expect(result.ok).toBe(true); // inner if fails -> not passes
	});
	it('unquoted variable name is dereferenced (should fail)', async () => {
		const feature = { path: '/features/test.feature', content: 'set foo to 7\nvariable foo is "7"' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers]);
		expect(result.ok).toBe(false); // resolves foo -> 7 then looks for var named 7
	});
	it('quoted variable name is literal (passes)', async () => {
		const feature = { path: '/features/test.feature', content: 'set foo to 7\nvariable "foo" is "7"' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers]);
		expect(result.ok).toBe(true);
	});
});

describe('not variable is set', () => {
	it('should fail when variable is set, pass when not set', async () => {
		const feature = {
			path: '/features/test.feature',
			content: 'set "a" to 1\nnot variable "a" is set\nends with NOT OK',
		};
		const result = await testWithDefaults([feature], [Haibun, VariablesSteppers]);
		// Print diagnostics if it fails
		if (!result.ok) {
			// Print top-level failure
			// Print step-level failures
			if (result.featureResults) {
				for (const fr of result.featureResults) {
					for (const step of fr.stepResults) {
						if (step && step.ok === false) {
							// step failed, diagnostics removed
						}
					}
				}
			}
		}
		expect(result.ok).toBe(false);
	});
});

