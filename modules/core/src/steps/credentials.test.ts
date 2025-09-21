import { describe, it, expect } from 'vitest';
import Credentials from './credentials.js';
import { testWithDefaults } from '../lib/test/lib';

describe('credentials', () => {
	it('hasRandomUsername', async () => {
		const feature = { path: '/features/d.feature', content: 'have a valid random username <boop>' };
		const res = await testWithDefaults([feature], [Credentials]);
		expect(res.ok).toBe(true);

		expect(res.world.shared.get('__cred_boop')).toBeDefined()
	});
});
