import { describe, it, test, expect } from 'vitest';

import { OK, TResolvedFeature, TStepperStep } from './defs.js';
import { AStepper } from './astepper.js';
import { getNamedMatches, namedInterpolation, matchGroups, getNamedToVars } from './namedVars.js';
import { Resolver } from '../phases/Resolver.js';
import { actionNotOK, createSteppers, getSerialTime } from './util/index.js';
import { getDefaultWorld, testWithDefaults, TEST_BASE } from './test/lib.js';
import { asExpandedFeatures } from './resolver-features.js';
import { withNameType } from './features.js';
import Vars from '../steps/vars.js';

describe('namedMatches', () => {
	const step: TStepperStep = {
		match: /^(?<one>.*?) is (?<two>.*?)$/,
		action: async () => Promise.resolve(actionNotOK('test')),
	};

	it('gets named matches', () => {
		expect(getNamedMatches(step.match as RegExp, 'It is set')).toEqual({ one: 'It', two: 'set' });
	});
});

describe('namedInterpolation', () => {
	test('gets string', () => {
		expect(namedInterpolation('hi').str).toEqual('hi');
	});
	test('gets var', () => {
		expect(namedInterpolation('{hi}')).toEqual({ str: `${matchGroups(0)}`, vars: [{ name: 'hi', type: 'string' }] });
	});
	test('gets var with type', () => {
		expect(namedInterpolation('{hi: string}')).toEqual({ str: `${matchGroups(0)}`, vars: [{ name: 'hi', type: 'string' }] });
	});
	test('gets var with post string', () => {
		expect(namedInterpolation('{hi} eh')).toEqual({ str: `${matchGroups(0)} eh`, vars: [{ name: 'hi', type: 'string' }] });
	});
	test('gets vars', () => {
		expect(namedInterpolation('{hi} and {there}')).toEqual({
			str: `${matchGroups(0)} and ${matchGroups(1)}`,
			vars: [
				{ name: 'hi', type: 'string' },
				{ name: 'there', type: 'string' },
			],
		});
	});
	test('gets vars with post text', () => {
		expect(namedInterpolation('{hi} and {there} eh')).toEqual({
			str: `${matchGroups(0)} and ${matchGroups(1)} eh`,
			vars: [
				{ name: 'hi', type: 'string' },
				{ name: 'there', type: 'string' },
			],
		});
	});
	test('throws for bad type', () => {
		expect(() => namedInterpolation('{hi: wtw}')).toThrow();
	});
});
describe('namedInterpolation regexes', () => {
	test('regexes single', () => {
		const r = new RegExp(namedInterpolation('{ v1: string } ').str);

		expect(r.exec('"hi" there')?.groups?.q_0).toBe('hi');
		expect(r.exec('<hi> there')?.groups?.c_0).toBe('hi');
		expect(r.exec('`hi` there')?.groups?.b_0).toBe('hi');
		expect(r.exec('hi there')?.groups?.t_0).toBe('hi');
	});

	test('regexes two', () => {
		const r2 = new RegExp(namedInterpolation('{ v1 } is { v2 }').str);
		const x = r2.exec('this is that');
		expect(x?.groups?.t_0).toBe('this');
		expect(x?.groups?.t_1).toBe('that');
	});
});

describe('getNamedWithVars', () => {
	class TestStepper extends AStepper {
		steps = {
			gwtaInterpolated: {
				gwta: 'is {what}',
				action: async () => Promise.resolve(OK),
			},
		};
	}
	const world = getDefaultWorld(0);
	test('gets var', async () => {
		const steppers = await createSteppers([TestStepper]);
		const resolver = new Resolver(steppers);
		world.shared.set('exact', 'res');
		const features = asExpandedFeatures([withNameType(TEST_BASE, 'l1', 'is `exact`')]);
		const steps = await resolver.resolveStepsFromFeatures(features);
		const { featureSteps } = steps[0] as TResolvedFeature;
		expect(featureSteps[0].action).toBeDefined();
		const val = getNamedToVars(featureSteps[0].action, world, featureSteps[0]);
		expect(val?.what).toBe('res');
	});
});

describe('special', () => {
	it('assigns [SERIALTIME]', async () => {
		const feature = { path: '/features/here.feature', content: 'set t to [SERIALTIME]' };
		const now = getSerialTime();
		const res = await testWithDefaults([feature], [Vars]);
		const t = res.world.shared.get('t');
		expect(t).toBeDefined();
		expect(parseInt(t)).toBeGreaterThanOrEqual(now);
	});
	it('rejects unknown', async () => {
		const fails = { path: '/features/here.feature', content: 'set [NOTHING] to y' };
		const res = await testWithDefaults([fails], [Vars]);
		expect(res.ok).toBe(false);
	});
});
