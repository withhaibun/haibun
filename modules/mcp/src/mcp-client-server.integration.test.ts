import { describe, it, expect } from 'vitest';

import { getStepperOptionName } from '@haibun/core/build/lib/util/index.js';
import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';

import MCPClientStepper from './mcp-client-stepper.js';
import { serverParameters } from './mcp-client-stepper.integration.test.js';

describe('mcp client - server integration', () => {
	it('client can list tools from server', async () => {
		const feature = { path: '/features/test.feature', content: `list mcp tools` };
		const res = await testWithDefaults([feature], [MCPClientStepper], {
			options: { DEST: DEFAULT_DEST },
			moduleOptions: { [getStepperOptionName(MCPClientStepper, MCPClientStepper.SERVER)]: JSON.stringify(serverParameters) },
		});
		expect(res.ok).toBe(true);
	});
});
