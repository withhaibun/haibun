import { passWithDefaults } from '@haibun/core/lib/test/lib.js';

import haibunMcp from './mcp-server-stepper.js';
import { describe, it, expect } from 'vitest';

describe('haibunMcp test', () => {
	it('starts and stops server', async () => {
		const feature = { path: '/features/test.feature', content: `serve mcp tools from steppers\nstop mcp tools` };
		const result = await passWithDefaults([feature], [haibunMcp]);
		expect(result.ok).toBe(true);
	});
});
