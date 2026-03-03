import { describe, expect, it } from 'vitest';
import { passWithDefaults } from '../lib/test/lib.js';
import VariablesStepper from './variables-stepper.js';
import LogicStepper from './logic-stepper.js';
import Haibun from './haibun.js';
import FinalizerStepper from './finalizer-stepper.js';

describe('finalizer-stepper', () => {
	it('registers and runs one statement per finalizer step', async () => {
		const result = await passWithDefaults(
			[
				{
					path: '/features/main.feature',
					content: 'set counterA as number to 0\nset counterB as number to 0\nfinalizer increment counterA\nfinalizer increment counterB',
				},
			],
			[VariablesStepper, LogicStepper, Haibun, FinalizerStepper],
			{ options: { DEST: 'default' }, moduleOptions: {} }
		);

		expect(result.ok).toBe(true);
		expect(result.world.shared.all().counterA?.value).toBe('1');
		expect(result.world.shared.all().counterB?.value).toBe('1');
	});

	it('does nothing when no finalizer steps are provided', async () => {
		const result = await passWithDefaults(
			[{ path: '/features/main.feature', content: 'set baseline to "ok"' }],
			[VariablesStepper, Haibun, FinalizerStepper],
			{ options: { DEST: 'default' }, moduleOptions: {} }
		);

		expect(result.ok).toBe(true);
		expect(result.world.shared.all().baseline?.value).toBe('ok');
	});
});