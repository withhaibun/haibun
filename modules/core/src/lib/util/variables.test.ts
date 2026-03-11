import { describe, it, expect } from 'vitest';
import { passWithDefaults } from '../test/lib.js';
import VariablesStepper from '../../steps/variables-stepper.js';
import Haibun from '../../steps/haibun.js';
import { Origin } from '../../schema/protocol.js';

const steppers = [VariablesStepper, Haibun];

describe('variables integration', () => {
	it('resolves variables from world', async () => {
		const feature = { path: '/features/test.feature', content: 'set x to "1"' };
		const res = await passWithDefaults([feature], steppers);
		if (!res.ok) console.error(JSON.stringify(res.failure, null, 2));
		expect(res.ok).toBe(true);
		const world = res.world;

		const resolved = world.shared.resolveVariable({ term: 'x', origin: Origin.var });
		expect(resolved.value).toBe('1');
	});

	it('resolves env variables', async () => {
		const feature = { path: '/features/test.feature', content: '' };
		const res = await passWithDefaults([feature], steppers, { options: { DEST: 'default', envVariables: { TEST_ENV: 'val' } }, moduleOptions: {} });
		expect(res.ok).toBe(true);
		const world = res.world;

		const resolved = world.shared.resolveVariable({ term: 'TEST_ENV', origin: Origin.env });
		expect(resolved.value).toBe('val');
	});

	it('resolves defined origin', async () => {
		const feature = { path: '/features/test.feature', content: 'set x to "stored"' };
		const res = await passWithDefaults([feature], steppers, { options: { DEST: 'default', envVariables: { ENV_VAR: 'env' } }, moduleOptions: {} });
		const world = res.world;

		// Prioritizes Env
		const resolvedEnv = world.shared.resolveVariable({ term: 'ENV_VAR', origin: Origin.defined });
		expect(resolvedEnv.value).toBe('env');
		expect(resolvedEnv.origin).toBe(Origin.env);

		// Falls back to Stored
		const resolvedStored = world.shared.resolveVariable({ term: 'x', origin: Origin.defined });
		expect(resolvedStored.value).toBe('stored');
		expect(resolvedStored.origin).toBe(Origin.var);

		// Returns undefined if neither (no literal fallback)
		const resolvedMissing = world.shared.resolveVariable({ term: 'missing', origin: Origin.defined });
		expect(resolvedMissing.value).toBeUndefined();
	});

});
