import { describe, expect, it } from 'vitest';
import { getDefaultWorld, passWithDefaults } from '../lib/test/lib.js';
import { discoverSteps } from '../lib/step-dispatch.js';

import { AStepper } from '../lib/astepper.js';
import { OK } from '../schema/protocol.js';
import { actionNotOK } from '../lib/util/index.js';
import ZcapLikeStepper from './zcap-like-stepper.js';
import { getZcapLikeAuthority } from '../lib/zcap-like-authority.js';

class VerifyZcapLikeStepper extends AStepper {
	steps = {
		verifyIssuedZcapLikeGrant: {
			gwta: 'verify zcap-like bearer grant for token {token: zcap-like-token} is active for capability {capability: zcap-like-capability}',
			action: ({ token, capability }: { token: string; capability: string }) => {
				const granted = getZcapLikeAuthority(this.getWorld().runtime)?.resolveBearerToken(token) ?? [];
				return granted.includes(capability)
					? OK
					: actionNotOK(`Expected ${token} to grant ${capability}, got ${JSON.stringify(granted)}`);
			},
		},
		verifyRevokedZcapLikeGrant: {
			gwta: 'verify zcap-like bearer grant for token {token: zcap-like-token} is revoked for capability {capability: zcap-like-capability}',
			action: ({ token, capability }: { token: string; capability: string }) => {
				const granted = getZcapLikeAuthority(this.getWorld().runtime)?.resolveBearerToken(token) ?? [];
				return !granted.includes(capability)
					? OK
					: actionNotOK(`Expected ${token} to stop granting ${capability}, got ${JSON.stringify(granted)}`);
			},
		},
	};
}

describe('ZcapLikeStepper', () => {
	it('registers zcap-like domains and exposes schemas through discovery', async () => {
		const world = getDefaultWorld();
		const stepper = new ZcapLikeStepper();
		await stepper.setWorld(world, [stepper]);
		const concerns = stepper.cycles.getConcerns?.();
		if (!concerns?.domains) throw new Error('Expected zcap-like domains to be declared');
		for (const domain of concerns.domains) {
			world.domains[domain.selectors[0]] = {
				selectors: [...domain.selectors],
				schema: domain.schema,
				coerce: domain.coerce ?? ((proto) => domain.schema.parse(proto.value)),
				comparator: domain.comparator,
				values: domain.values,
				description: domain.description,
			};
		}

		const discovery = discoverSteps([stepper], world);
		expect(discovery.domains['zcap-like-token']?.description).toContain('Opaque bearer token');
		expect(discovery.domains['zcap-like-capability']?.description).toContain('Namespaced capability');

		const issueStep = discovery.metadata.find((step) => step.method === 'ZcapLikeStepper-issueZcapLikeBearerGrant');
		expect(issueStep?.inputSchema?.required).toEqual(['token', 'capability']);
		expect(issueStep?.outputSchema).toBeDefined();
	});

	it('issues and revokes zcap-like bearer grants through normal steps', async () => {
		const feature = {
			path: '/features/zcap-like-stepper.feature',
			content: `
issue zcap-like bearer grant for token "alpha" with capability "Ping:protected"
verify zcap-like bearer grant for token "alpha" is active for capability "Ping:protected"
revoke zcap-like bearer grant for token "alpha"
verify zcap-like bearer grant for token "alpha" is revoked for capability "Ping:protected"
`,
		};

		const result = await passWithDefaults([feature], [ZcapLikeStepper, VerifyZcapLikeStepper]);
		if (!result.ok) {
			throw new Error(JSON.stringify(result.featureResults, null, 2));
		}
		expect(result.ok).toBe(true);
	});
});