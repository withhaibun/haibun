import { describe, it, expect } from 'vitest';
import { getTestWorldWithOptions } from './test/lib';
import { populateActionArgs } from './populateActionArgs';
import { TFeatureStep } from './defs';
import { Origin } from '../schema/protocol.js';
import { AStepper } from './astepper.js';

function makeStep(name: string, label: string, domain: string, origin: Origin): TFeatureStep {
	return {
		path: 'test',
		in: '',
		seqPath: [0],
		action: {
			actionName: 'test',
			stepperName: 'test',
			step: {
				action: async () => {
					return Promise.resolve({ ok: true });
				}
			},
			stepValuesMap: {
				[name]: { term: label, domain, origin },
			},
		},
	};
}

describe('populateActionArgs integration', () => {
	it('resolves statement origin and coerces string', () => {
		const step = makeStep('foo', 'bar', 'string', Origin.statement);
		const world = getTestWorldWithOptions();
		const steppers: AStepper[] = [];
		const args = populateActionArgs(step, world, steppers);
		expect(args.foo).toBe('bar');
	});

	it('resolves env origin', () => {
		const step = makeStep('foo', 'ENV_VAR', 'string', Origin.env);
		const world = getTestWorldWithOptions({ options: { DEST: 'test', envVariables: { ENV_VAR: 'envval' } }, moduleOptions: {} });
		const steppers: AStepper[] = [];
		const args = populateActionArgs(step, world, steppers);
		expect(args.foo).toBe('envval');
	});

	it('throws on missing env variable', () => {
		const step = makeStep('foo', 'NOPE', 'string', Origin.env);
		const world = getTestWorldWithOptions();
		const steppers: AStepper[] = [];
		expect(() => populateActionArgs(step, world, steppers)).toThrow();
	});

	it('throws on missing domain coercer', () => {
		const step = makeStep('foo', 'bar', 'notadomain', Origin.statement);
		const world = getTestWorldWithOptions();
		const steppers: AStepper[] = [];
		expect(() => populateActionArgs(step, world, steppers)).toThrow();
	});
});
