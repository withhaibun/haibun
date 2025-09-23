import { describe, it, expect } from 'vitest';
import { testWithDefaults } from '@haibun/core/lib/test/lib.js';
import HaibunMobileStepper from './haibun-mobile-stepper.js';

void describe('example test', () => {
	void it('runs a simple test', async () => {
		const feature = { path: '/features/here.feature', content: 'set t to [SERIALTIME]' };
		const res = await testWithDefaults([feature], [HaibunMobileStepper]);
		expect(res.ok).toBe(false);
	});
});
