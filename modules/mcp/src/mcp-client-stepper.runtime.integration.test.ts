import { describe, it, expect } from 'vitest';

import VariablesStepper from '@haibun/core/steps/variables-stepper.js';
import { runtimeStdio, TEST_PORTS } from './mcp-test-utils.js';
import { testWithDefaults } from '@haibun/core/lib/test/lib.js';
import { DEFAULT_DEST } from '@haibun/core/lib/defs.js';
import { getStepperOptionName } from '@haibun/core/lib/util/index.js';

import MCPClientStepper from './mcp-client-stepper.js';

describe('mcp client test local', () => {
	it('list tools', async () => {
		const feature = { path: '/features/test.feature', content: `list mcp tools` };
		const result = await testWithDefaults([feature], [MCPClientStepper, VariablesStepper], {
			options: { DEST: DEFAULT_DEST },
			moduleOptions: {
				[getStepperOptionName(MCPClientStepper, MCPClientStepper.SERVER)]: runtimeStdio()
			},
		});
		expect(result.ok).toBe(true);
	});
});

describe('mcp client test remote', () => {
	it('client can list tools from server', async () => {
		const feature = { path: '/features/test.feature', content: `list mcp tools\nset finished-mcp to "true"\nshow vars` };
		const res = await testWithDefaults([feature], [MCPClientStepper, VariablesStepper], {
			options: { DEST: DEFAULT_DEST },
			moduleOptions: { [getStepperOptionName(MCPClientStepper, MCPClientStepper.SERVER)]: runtimeStdio(TEST_PORTS.MCP_CLIENT_LIST_TOOLS) },
		});
		expect(res.ok).toBe(true);
	});
});
