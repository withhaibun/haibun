import { describe, it, expect } from 'vitest';
import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import { getStepperOptionName } from '@haibun/core/build/lib/util/index.js';

import { MCPExecutorServer } from './lib/mcp-executor-server.js';
import WebServerStepper from '@haibun/web-server-express/build/web-server-stepper.js';
import RemoteExecutorStepper from '@haibun/web-server-express/build/http-executor-stepper.js';
import VariablesStepper from '@haibun/core/build/steps/variables-stepper.js';

describe('MCP Remote Executor integration', () => {
	const webPort = '8126';
	const accessToken = 'mcp-test-token-456';

	it('can create MCP server with remote config', async () => {
		const feature = {
			path: '/features/mcp-remote.feature',
			content: `
				set testVar to "mcp test"
				display testVar
			`
		};

		const options = {
			options: { DEST: DEFAULT_DEST },
			moduleOptions: {
				[getStepperOptionName(new RemoteExecutorStepper(), 'LISTEN_PORT')]: webPort,
				[getStepperOptionName(new RemoteExecutorStepper(), 'ACCESS_TOKEN')]: accessToken,
			},
		};

		const result = await testWithDefaults(
			[feature],
			[WebServerStepper, RemoteExecutorStepper, VariablesStepper],
			options
		);

		expect(result.ok).toBe(true);

		// Test MCP server creation with remote config
		const mcpServer = new MCPExecutorServer(
			result.steppers,
			result.world,
			{
				url: `http://localhost:${webPort}`,
				accessToken
			}
		);

		expect(mcpServer).toBeDefined();
		expect(mcpServer.server).toBeUndefined(); // Not started yet
	});

	it('can create MCP server without remote config for direct execution', async () => {
		const feature = {
			path: '/features/mcp-direct.feature',
			content: `
				set directVar to "direct execution"
				display directVar
			`
		};

		const options = {
			options: { DEST: DEFAULT_DEST },
			moduleOptions: {},
		};

		const result = await testWithDefaults(
			[feature],
			[VariablesStepper],
			options
		);

		expect(result.ok).toBe(true);

		// Test MCP server creation without remote config (direct execution)
		const mcpServer = new MCPExecutorServer(
			result.steppers,
			result.world
		);

		expect(mcpServer).toBeDefined();
		expect(mcpServer.server).toBeUndefined(); // Not started yet
	});
});
