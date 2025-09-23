import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { testWithDefaults } from '@haibun/core/lib/test/lib.js';
import HaibunMobileStepper from './haibun-mobile-stepper.js';

void describe('example test', () => {
	void it('runs a simple test', async () => {
		const feature = { path: '/features/here.feature', content: 'set t to [SERIALTIME]' };
		const res = await testWithDefaults([feature], [HaibunMobileStepper]);
		assert(res.ok, `Test failed: ${res.failure}`);
	});
});
