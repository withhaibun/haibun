import { describe, it, test, expect } from 'vitest';

import { DEFAULT_DEST } from './defs.js';
import * as steps from './features.js';
import { testWithDefaults } from './test/lib.js';
import { asFeatures } from './resolver-features.js';
import VariablesStepper from '../steps/variables-stepper.js';

const varsStepper = [VariablesStepper];

describe('expandBackgrounds', () => {
	test('simple', async () => {
		const features = asFeatures([{ path: '/f1', content: 'f1_step' }]);

		const res = await steps.expandBackgrounds(features);

		expect(res).toEqual(features);
	});
	test('hierarchical', async () => {
		const features = asFeatures([
			{ path: '/f1', content: 'f1_step' },
			{ path: '/f1/l1f1', content: 'l1f1_step' },
		]);
		const expected = asFeatures([
			{ path: '/f1', content: 'f1_step' },
			{ path: '/f1/l1f1', content: 'f1_step\nl1f1_step' },
		]);
		const res = await steps.expandBackgrounds(features);

		expect(res).toEqual(expected);
	});
	test('multiple hierarchical', async () => {
		const features = asFeatures([
			{ path: '/f1', content: 'f1_step' },
			{ path: '/l1/l1f1', content: 'l1_step' },
			{ path: '/l2/l2f1', content: 'l2_step' },
		]);
		const expected = asFeatures([
			{ path: '/f1', content: 'f1_step' },
			{ path: '/l1/l1f1', content: 'f1_step\nl1_step' },
			{ path: '/l2/l2f1', content: 'f1_step\nl2_step' },
		]);
		const res = await steps.expandBackgrounds(features);

		expect(res).toEqual(expected);
	});
});

describe('feature finding', () => {
	const features = asFeatures([
		{ path: '/l0.feature', content: 'l0_feature' },
		{ path: '/l0/l1.feature', content: 'l1_feature' },
	]);
	test('does not find partial feature', () => {
		const res = steps.findFeatures('0', features);
		expect(res).toEqual([]);
	});
	test('finds feature', () => {
		const res = steps.findFeatures('l0', features);
		expect(res).toEqual(asFeatures([{ path: '/l0.feature', content: 'l0_feature' }]));
	});
	test('finds l1 feature', () => {
		const res = steps.findFeatures('l1', features);
		expect(res).toEqual(asFeatures([{ path: '/l0/l1.feature', content: 'l1_feature' }]));
	});
	test('finds multiple', () => {
		const res = steps.findFeatures('l1', asFeatures([...features, { path: '/l1/l1.feature', content: 'l1_l1_feature' }]));
		expect(res).toEqual(
			asFeatures([
				{ path: '/l0/l1.feature', content: 'l1_feature' },
				{ path: '/l1/l1.feature', content: 'l1_l1_feature' },
			])
		);
	});
	test('finds fileType', () => {
		const res = steps.findFeatures(
			'l1',
			asFeatures([...features, { path: '/l1/l1.mytype.feature', content: 'l1_l1_mytype.feature' }]),
			'mytype'
		);
		expect(res).toEqual(asFeatures([{ path: '/l1/l1.mytype.feature', content: 'l1_l1_mytype.feature' }]));
	});
});

describe('expand features', () => {
	test('applies backgrounds', async () => {
		const features = asFeatures([{ path: '/f1', content: 'Backgrounds: b1\nExtant' }]);
		const backgrounds = asFeatures([{ path: '/b1.feature', content: 'result' }]);
		const res = await steps.expandFeatures(features, backgrounds);

		expect(res[0].expanded.map((e) => e.line)).toEqual(['result', 'Extant']);
		expect(res[0].expanded.map((e) => e.feature.name)).toEqual(['/b1', '/f1']);
		expect(res[0].expanded.map((e) => e.feature.path)).toEqual(['/b1.feature', '/f1']);
		expect(res[0].expanded.map((e) => e.origin)).toEqual(['/b1.feature', '/f1']);
	});

	test('applies backgrounds hierarchical', async () => {
		const features = asFeatures([{ path: '/l1/f1', content: 'Backgrounds: b2' }]);
		const backgrounds = asFeatures([
			{ path: '/l1/b1.feature', content: 'non-result' },
			{ path: '/l2/b2.feature', content: 'result' },
		]);
		const res = await steps.expandFeatures(features, backgrounds);

		expect(res[0].expanded.length).toBe(1);
		expect(res[0].expanded[0].line).toEqual('result');
		expect(res[0].expanded[0].feature.name).toEqual('/l2/b2');
		expect(res[0].expanded[0].feature.path).toEqual('/l2/b2.feature');
		expect(res[0].expanded[0].origin).toEqual('/l2/b2.feature');
	});

	test('multiple features and backgrounds', async () => {
		const features = asFeatures([
			{ path: '/f1', content: 'Backgrounds: b1\nFeature step 1' },
			{ path: '/f2', content: 'Backgrounds: b2\nFeature step 2' },
		]);
		const backgrounds = asFeatures([
			{ path: '/b1.feature', content: 'Background step 1' },
			{ path: '/b2.feature', content: 'Background step 2' },
		]);
		const res = await steps.expandFeatures(features, backgrounds);

		expect(res[0].expanded.map((e) => e.line)).toEqual(['Background step 1', 'Feature step 1']);
		expect(res[0].expanded.map((e) => e.feature.path)).toEqual(['/b1.feature', '/f1']);
		expect(res[0].expanded.map((e) => e.origin)).toEqual(['/b1.feature', '/f1']);

		expect(res[1].expanded.map((e) => e.line)).toEqual(['Background step 2', 'Feature step 2']);
		expect(res[1].expanded.map((e) => e.feature.path)).toEqual(['/b2.feature', '/f2']);
		expect(res[1].expanded.map((e) => e.origin)).toEqual(['/b2.feature', '/f2']);
	});
});

describe('env vars', () => {
	it('env or var or literal finds env', async () => {
		const feature = { path: '/features/test.feature', content: `set "what" to "var"\nset x to {what}` };
		const envVariables = { what: 'env' };
		const { world } = await testWithDefaults([feature], varsStepper, {
			options: { DEST: DEFAULT_DEST, envVariables },
			moduleOptions: {},
		});
		expect(world.shared.get('what')).toBe('var');
		expect(world.shared.get('x')).toBe('env');
	});
	it('env or var or literal finds var', async () => {
		const feature = { path: '/features/test.feature', content: `set "what" to "var"\nset x to what` };
		const { world } = await testWithDefaults([feature], varsStepper);
		expect(world.shared.get('x')).toBe('var');
	});
	it('env or var or literal finds literal', async () => {
		const feature = { path: '/features/test.feature', content: `set x to what` };
		const { world } = await testWithDefaults([feature], varsStepper);
		expect(world.shared.get('x')).toBe('what');
	});
});
