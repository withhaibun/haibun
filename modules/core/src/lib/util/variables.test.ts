import { describe, it, expect } from 'vitest';
import { passWithDefaults } from '../test/lib.js';
import VariablesStepper from '../../steps/variables-stepper.js';
import Haibun from '../../steps/haibun.js';
import { resolveVariable } from './variables.js';
import { Origin } from '../defs.js';

const steppers = [VariablesStepper, Haibun];

describe('variables integration', () => {
	it('resolves variables from world', async () => {
		const feature = { path: '/features/test.feature', content: 'set x to "1"' };
		const res = await passWithDefaults([feature], steppers);
		expect(res.ok).toBe(true);
		const world = res.world;

		const resolved = resolveVariable({ term: 'x', origin: Origin.var }, world);
		expect(resolved.value).toBe('1');
	});

	it('resolves env variables', async () => {
		const feature = { path: '/features/test.feature', content: '' };
		const res = await passWithDefaults([feature], steppers, { options: { DEST: 'default', envVariables: { TEST_ENV: 'val' } }, moduleOptions: {} });
		expect(res.ok).toBe(true);
		const world = res.world;

		const resolved = resolveVariable({ term: 'TEST_ENV', origin: Origin.env }, world);
		expect(resolved.value).toBe('val');
	});

});
