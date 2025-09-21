import { describe, it, test, expect } from 'vitest';

import { OK, TResolvedFeature, TStepperStep, TStepArgs, Origin } from './defs.js';
import { AStepper } from './astepper.js';
import { getNamedMatches, namedInterpolation, /*matchGroups */ } from './namedVars.js';
import { Resolver } from '../phases/Resolver.js';
import { actionNotOK, createSteppers, } from './util/index.js';
import { getDefaultWorld, TEST_BASE } from './test/lib.js';
import { asExpandedFeatures } from './resolver-features.js';
import { withNameType } from './features.js';
import { populateActionArgs } from './populateActionArgs.js';
import { DOMAIN_STRING } from './domain-types.js';

describe('namedMatches', () => {
	const step: TStepperStep = {
		match: /^(?<one>.*?) is (?<two>.*?)$/,
		action: async () => Promise.resolve(actionNotOK('test')),
	};

	it('gets named matches', () => {
		expect(getNamedMatches(step.match as RegExp, 'It is set')).toEqual({ one: 'It', two: 'set' });
	});
});

/*
describe('namedInterpolation', () => {
	test('gets string', () => {
		expect(namedInterpolation('hi').regexPattern).toEqual('hi');
	});
	test('gets var', () => {
		const res = namedInterpolation('{hi}');
		expect(res.regexPattern).toEqual(`${matchGroups(0)}`);
		expect(res.stepValuesMap?.hi).toMatchObject({ label: 'hi', domain: DOMAIN_STRING });
	});
	test('gets var with domain explicit', () => {
		const res = namedInterpolation('{hi: string}');
		expect(res.regexPattern).toEqual(`${matchGroups(0)}`);
		expect(res.stepValuesMap?.hi).toMatchObject({ label: 'hi', domain: DOMAIN_STRING });
	});
	test('gets var with post string', () => {
		const res = namedInterpolation('{hi} eh');
		expect(res.regexPattern).toEqual(`${matchGroups(0)} eh`);
		expect(res.stepValuesMap?.hi).toMatchObject({ label: 'hi', domain: DOMAIN_STRING });
	});
	test('gets step placeholders', () => {
		const res = namedInterpolation('{hi} and {there}');
		expect(res.regexPattern).toEqual(`${matchGroups(0)} and ${matchGroups(1)}`);
		expect(res.stepValuesMap?.hi).toMatchObject({ label: 'hi', domain: DOMAIN_STRING });
		expect(res.stepValuesMap?.there).toMatchObject({ label: 'there', domain: DOMAIN_STRING });
	});
	test('gets step placeholders with post text', () => {
		const res = namedInterpolation('{hi} and {there} eh');
		expect(res.regexPattern).toEqual(`${matchGroups(0)} and ${matchGroups(1)} eh`);
		expect(res.stepValuesMap?.hi).toMatchObject({ label: 'hi', domain: DOMAIN_STRING });
		expect(res.stepValuesMap?.there).toMatchObject({ label: 'there', domain: DOMAIN_STRING });
	});
	test('unknown domain is accepted at parse time (runtime will validate)', () => {
		const res = namedInterpolation('{hi: not-a-domain}');
		expect(res.stepValuesMap?.hi).toMatchObject({ label: 'hi', domain: 'not-a-domain' });
	});
});
*/
describe('namedInterpolation regexes', () => {
	test('regexes single', () => {
		const r = new RegExp(namedInterpolation('{ v1: string } ').regexPattern);

		expect(r.exec('"hi" there')?.groups?.q_0).toBe('hi');
		expect(r.exec('<hi> there')?.groups?.c_0).toBe('hi');
		expect(r.exec('`hi` there')?.groups?.b_0).toBe('hi');
		expect(r.exec('hi there')?.groups?.t_0).toBe('hi');
	});

	test('regexes two', () => {
		const r2 = new RegExp(namedInterpolation('{ v1 } is { v2 }').regexPattern);
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
		world.shared.set({ label: 'exact', value: 'res', domain: DOMAIN_STRING, origin: Origin.fallthrough });
		const features = asExpandedFeatures([withNameType(TEST_BASE, 'l1', 'is `exact`')]);
		const steps = await resolver.resolveStepsFromFeatures(features);
		const { featureSteps } = steps[0] as TResolvedFeature;
		expect(featureSteps[0].action).toBeDefined();
		const val = await populateActionArgs(featureSteps[0], world, steppers) as TStepArgs;
		expect(val.what).toBe('res');
	});
});
