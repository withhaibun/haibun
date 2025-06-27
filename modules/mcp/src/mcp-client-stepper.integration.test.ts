import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import { getStepperOptionName } from '@haibun/core/build/lib/util/index.js';
import { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';

import MCPClientStepper from './mcp-client-stepper.js';
import { TEST_PORTS } from './test-constants.js';
import { describe, it, expect } from 'vitest';

export const serverParameters: StdioServerParameters = {
	command: process.execPath, // Use current Node.js executable (required when node is installed via nvm)
	env: {
		'HAIBUN_O_WEBPLAYWRIGHT_STORAGE': 'StorageMem',
		'HAIBUN_O_WEBPLAYWRIGHT_HEADLESS': 'true',
		// Use test ports to avoid conflicts with live servers
		'HAIBUN_O_WEBSERVERSTEPPER_PORT': TEST_PORTS.MCP_CLIENT_TEST.toString(),
		'HAIBUN_O_HTTPEXECUTORSTEPPER_LISTEN_PORT': (TEST_PORTS.MCP_CLIENT_TEST + 1).toString(),
	},
	args: [
		"modules/cli/build/cli.js",
		'--cwd',
		'modules/mcp/test',
		"tests",
	],
};

describe('mcp client test', () => {
	const options = {
		options: { DEST: DEFAULT_DEST },
		moduleOptions: { [getStepperOptionName(MCPClientStepper, MCPClientStepper.SERVER)]: JSON.stringify(serverParameters) },
	};
	it('list tools', async () => {
		const feature = { path: '/features/test.feature', content: `list mcp tools` };
		const result = await testWithDefaults([feature], [MCPClientStepper], options);
		expect(result.ok).toBe(true);
	});
});
