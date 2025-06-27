import { describe, it, expect } from 'vitest';

import { getStepperOptionName } from '@haibun/core/build/lib/util/index.js';
import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';

import MCPClientStepper from './mcp-client-stepper.js';
import { TEST_PORTS } from './test-constants.js';

const clientServerParameters: StdioServerParameters = {
	command: process.execPath, // Use current Node.js executable (required when node is installed via nvm)
	env: {
		'HAIBUN_O_WEBPLAYWRIGHT_STORAGE': 'StorageMem',
		'HAIBUN_O_WEBPLAYWRIGHT_HEADLESS': 'true',
		// Use test ports to avoid conflicts with live servers
		'HAIBUN_O_WEBSERVERSTEPPER_PORT': TEST_PORTS.MCP_CLIENT_SERVER.toString(),
		'HAIBUN_O_HTTPEXECUTORSTEPPER_LISTEN_PORT': (TEST_PORTS.MCP_CLIENT_SERVER + 1).toString(),
		'HAIBUN_O_HTTPEXECUTORSTEPPER_ACCESS_TOKEN': 'test-token-client-server',
	},
	args: [
		"modules/cli/build/cli.js",
		'--cwd',
		'modules/mcp/test',
		"tests",
	],
};

describe('mcp client - server integration', () => {
	it('client can list tools from server', async () => {
		const feature = { path: '/features/test.feature', content: `list mcp tools` };
		const res = await testWithDefaults([feature], [MCPClientStepper], {
			options: { DEST: DEFAULT_DEST },
			moduleOptions: { [getStepperOptionName(MCPClientStepper, MCPClientStepper.SERVER)]: JSON.stringify(clientServerParameters) },
		});
		expect(res.ok).toBe(true);
	});
});
