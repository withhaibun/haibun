import { describe, it, expect } from 'vitest';
import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import { DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';

import { MCPExecutorServer } from './lib/mcp-executor-server.js';
import VariablesStepper from '@haibun/core/build/steps/variables-stepper.js';

describe('MCP Remote Execution', () => {
	it('can create MCP server with and without remote config', async () => {
		const feature = {
			path: '/features/mcp-test.feature',
			content: `
				set testVar to "mcp execution test"
				display testVar
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

		// Test MCP server creation with remote config
		const remoteServer = new MCPExecutorServer(
			result.steppers,
			result.world,
			{
				url: 'http://localhost:8123',
				accessToken: 'test-token'
			}
		);

		expect(remoteServer).toBeDefined();
		expect(remoteServer.server).toBeUndefined(); // Not started yet

		// Test MCP server creation without remote config (direct execution)
		const directServer = new MCPExecutorServer(
			result.steppers,
			result.world
		);

		expect(directServer).toBeDefined();
		expect(directServer.server).toBeUndefined(); // Not started yet
	});
});
