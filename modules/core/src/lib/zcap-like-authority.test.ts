import { describe, expect, it } from 'vitest';

import { ZcapLikeAuthority } from './zcap-like-authority.js';

describe('ZcapLikeAuthority', () => {
	it('issues and resolves zcap-like bearer grants', () => {
		const authority = new ZcapLikeAuthority();
		authority.issueBearerGrant({ token: 'alpha', capability: 'Ping:protected' });
		expect(authority.resolveBearerToken('alpha')).toEqual(['Ping:protected']);
	});

	it('supports multiple active zcap-like grants for one bearer token', () => {
		const authority = new ZcapLikeAuthority();
		authority.issueBearerGrant({ token: 'alpha', capability: 'Ping:protected' });
		authority.issueBearerGrant({ token: 'alpha', capability: 'Other:*' });
		expect(authority.resolveBearerToken('alpha')).toEqual([
			'Ping:protected',
			'Other:*',
		]);
	});

	it('revokes zcap-like bearer grants without deleting grant history', () => {
		const authority = new ZcapLikeAuthority();
		authority.issueBearerGrant({ token: 'alpha', capability: 'Ping:protected' });
		expect(authority.revokeBearerGrant('alpha')).toBe(1);
		expect(authority.resolveBearerToken('alpha')).toEqual([]);
		expect(authority.listBearerGrants()[0]).toMatchObject({
			token: 'alpha',
			capability: 'Ping:protected',
			revoked: true,
		});
	});
});