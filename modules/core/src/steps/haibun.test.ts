import { describe, it, expect } from 'vitest';

import { DEF_PROTO_OPTIONS,  testWithDefaults } from '../lib/test/lib.js';
import TestSteps from '../lib/test/TestSteps.js';
import Haibun from './haibun.js';
import VariablesSteppers from './variables-stepper.js';

describe('seqPath ordering', () => {
	// seqPath format: [featureNum, scenarioNum, ...stepPath]
	// featureNum: 1-based feature number
	// scenarioNum: 1-based scenario number (1 when no scenario declared)
	// stepPath: hierarchical step numbering with negative numbers for conditions

	it('linear steps have incremental single-element seqPath', async () => {
		const feature = { path: '/features/test.feature', content: 'passes\npasses\npasses' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		expect(seqs).toEqual([[1,1,1], [1,1,2], [1,1,3]]);
	});
	it('if with Backgrounds shows condition, directive, background steps, then parent', async () => {
		const feature = { path: '/features/test.feature', content: 'if passes, Backgrounds: bg' };
		const background = { path: '/backgrounds/bg.feature', content: 'set ran to true\nends with ok' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		// Condition uses dir=-1, body uses dir=1: condition [1,1,1,-1], background steps [1,1,1,1] and [1,1,1,2], parent [1,1,1]
		expect(seqs).toEqual([[1,1,1,-1], [1,1,1,1], [1,1,1,2], [1,1,1]]);
	});
	it('not statement', async () => {
		const feature = { path: '/features/test.feature', content: 'passes\nnot fails\nends with OK' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		expect(seqs).toEqual([[1,1,1], [1,1,2,-1], [1,1,2], [1,1,3]]);
	});
	it('not not statement', async () => {
		const feature = { path: '/features/test.feature', content: 'passes\nnot not passes\nends with OK' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		expect(seqs).toEqual([[1,1,1], [1,1,2,-1,-1], [1,1,2,-1], [1,1,2], [1,1,3]]);
	});
});
describe('afterEvery', () => {
	it('afterEvery effect injects step', async () => {
		const feature = { path: '/features/test.feature', content: 'have a test\nafter every TestSteps, Noodles, man.\npasses\npasses' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const ins = result.featureResults![0].stepResults.map(r => r.in);
		expect(ins).toEqual(['have a test', 'after every TestSteps, Noodles, man.', 'passes', 'Noodles, man.', 'passes', 'Noodles, man.' ]);
	});
	it('afterEvery effect injects hierarchical step with parent seqPath extended', async () => {
		const feature = { path: '/features/test.feature', content: 'have a test\nafter every TestSteps, passes\nhave a test\npasses' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		// Step [1,1,4] "passes" does not trigger afterEvery because it's the same action (prevents infinite recursion)
		expect(seqs).toEqual([[1,1,1], [1,1,2], [1,1,3], [1,1,3,1], [1,1,4]]);
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
		// All steps recorded: condition, background steps, then parent if
		expect(steps.length).toBe(4);
		const seqs = steps.map(s => s.seqPath);
		expect(seqs).toEqual([[1,1,1,-1], [1,1,1,1], [1,1,1,2], [1,1,1]]);
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
		console.log('🤑', JSON.stringify(result.failure, null, 2));
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
	it('invalid background fails during Resolve', async () => {
		const feature = { path: '/features/test.feature', content: 'if passes, Backgrounds: nonexistent' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, []);
		expect(result.ok).toBe(false);
		expect(result.failure?.stage).toBe('Resolve');
		expect(result.failure?.error.message).toMatch(/can't find single "nonexistent.feature"/);
	});
	it('simple Backgrounds fails during Expand', async () => {
		const feature = { path: '/features/test.feature', content: 'Backgrounds: missing' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, []);
		expect(result.ok).toBe(false);
		expect(result.failure?.stage).toBe('Expand');
		expect(result.failure?.error.message).toMatch(/can't find single "missing.feature"/);
	});
	it('not invalid Backgrounds fails during Resolve', async () => {
		const feature = { path: '/features/test.feature', content: 'not Backgrounds: nowhere' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, []);
		expect(result.ok).toBe(false);
		expect(result.failure?.stage).toBe('Resolve');
		expect(result.failure?.error.message).toMatch(/can't find single "nowhere.feature"/);
	});
	it('background steps have correct file path', async () => {
		const feature = { path: '/features/test.feature', content: 'if passes, Backgrounds: bg' };
		const background = { path: '/backgrounds/bg.feature', content: 'set ran to true\nends with ok' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);

		const paths = result.featureResults![0].stepResults.map(r => r.path);
		// Condition step (from feature), two background steps (from bg.feature), then parent if (from feature)
		expect(paths).toEqual([
			'/features/test.feature',  // condition: "passes"
			'/backgrounds/bg.feature',  // background step: "set ran to true"
			'/backgrounds/bg.feature',  // background step: "ends with ok"
			'/features/test.feature'    // parent if
		]);
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
		expect(seqs).toEqual([[1,1,1,-1], [1,1,1]]);
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
	it('quoted variable name is literal (passes)', async () => {
		const feature = { path: '/features/test.feature', content: 'set foo to 7\nvariable "foo" is "7"' };
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers]);
		expect(result.ok).toBe(true);
	});

	it('deeply nested negation with variable "who" demonstrates seqPath hierarchy', async () => {
		// Tests that nested negations properly extend seqPath with -1 at each level.
		// Validates the complete execution trace through four meta-levels.
		const feature = {
			path: '/features/test.feature',
			content: 'set who to "there"\nnot not not not variable "who" is "there"'
		};
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers]);
		expect(result.ok).toBe(true);

		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		// Verifies seqPath structure through recursive descent and ascent:
		// [1,1,1] - variable assignment
		// [1,1,2,-1,-1,-1,-1] - innermost condition evaluation
		// [1,1,2,-1,-1,-1] - third negation layer
		// [1,1,2,-1,-1] - second negation layer
		// [1,1,2,-1] - first negation layer
		// [1,1,2] - final statement resolution
		expect(seqs).toEqual([[1,1,1], [1,1,2,-1,-1,-1,-1], [1,1,2,-1,-1,-1], [1,1,2,-1,-1], [1,1,2,-1], [1,1,2]]);
		expect(seqs.length).toBe(6);
	});

	it('if-not-if demonstrates nested conditional evaluation with contradictory conditions', async () => {
		// Tests behavior when outer if condition succeeds but inner if condition
		// contradicts it. Verifies that inner if with false condition succeeds vacuously
		// and that all conditions and resolutions are recorded in stepResults.
		const feature = {
			path: '/features/test.feature',
			content: 'set who to "there"\nif variable "who" is "there", if not variable "who" is "there", passes'
		};
		const result = await testWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers]);
		expect(result.ok).toBe(true); // outer succeeds, inner condition fails but if succeeds, body never runs

		const seqs = result.featureResults![0].stepResults.map(r => r.seqPath);
		// Validates complete execution trace with nested conditions:
		// [1,1,1] - variable assignment
		// [1,1,2,-1] - outer if condition evaluation (succeeds)
		// [1,1,2,1,-1,-1] - inner not's deepest evaluation
		// [1,1,2,1,-1] - inner not resolution (evaluates to false)
		// [1,1,2,1] - inner if resolution (condition false, succeeds without executing body)
		// [1,1,2] - outer if resolution (consequence executed successfully)
		expect(seqs).toEqual([[1,1,1], [1,1,2,-1], [1,1,2,1,-1,-1], [1,1,2,1,-1], [1,1,2,1], [1,1,2]]);
		expect(seqs.length).toBe(6);
	});
	});
