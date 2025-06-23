import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';

import haibunMcp from './mcp-client-stepper.js';
import { describe, it, expect } from 'vitest';

describe('haibunMcp test', () => {
	it('passes', async () => {
		const feature = { path: '/features/test.feature', content: `your test phrase passes` };
		const result = await testWithDefaults([feature], [haibunMcp]);
		expect(result.ok).toBe(true);
	});
	it('fails', async () => {
		const feature = { path: '/features/test.feature', content: `your test phrase fails` };
		const result = await testWithDefaults([feature], [haibunMcp]);
		expect(result.ok).toBe(false);
	});
});
