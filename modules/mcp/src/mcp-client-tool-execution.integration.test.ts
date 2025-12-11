import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { currentVersion as version } from '@haibun/core/currentVersion.js';
import { runtimeStdio, TEST_PORTS } from './mcp-test-utils.js';

const toolExecutionServerParameters = runtimeStdio(TEST_PORTS.MCP_TOOL_EXECUTION);

describe('haibun-mcp tool execution', () => {
	let client: Client;
	let transport: StdioClientTransport;

	beforeAll(async () => {
		client = new Client({ name: "haibun-mcp-test-client", version });
		transport = new StdioClientTransport(JSON.parse(toolExecutionServerParameters));
		await client.connect(transport);
	});

	afterAll(async () => {
		await client.close();
	});

	it('can list all available haibun tools', async () => {
		const toolsResult = await client.listTools();
		const tools = toolsResult.tools || [];

		expect(tools.length).toBeGreaterThan(0);

		// Should have MCP server control tools
		expect(tools.some(t => t.name === 'MCPServerStepper-startMcpTools')).toBe(true);
		expect(tools.some(t => t.name === 'MCPServerStepper-stopMcpTools')).toBe(true);

		// Should have variable management tools
		expect(tools.some(t => t.name === 'VariablesStepper-set')).toBe(true);
		expect(tools.some(t => t.name === 'VariablesStepper-showVars')).toBe(true);

		// Should have utility tools
		expect(tools.some(t => t.name === 'Haibun-pauseSeconds')).toBe(true);
	});

	it('can execute variable setting and showVars tools', async () => {
		// Set a variable using the VariablesStepper-set tool
		const setResult = await client.callTool({
			name: 'VariablesStepper-set',
			arguments: {
				what: 'testVariable',
				value: '"Hello from MCP"'
			}
		});

		expect(setResult.content).toBeDefined();
		expect(Array.isArray(setResult.content)).toBe(true);
		const setContent = setResult.content as Array<{ type: string; text: string }>;
		expect(setContent[0].type).toBe('text');
		const setResponse = JSON.parse(setContent[0].text);
		expect(setResponse.stepName).toBe('set');
		expect(setResponse.stepperName).toBe('VariablesStepper');
		expect(setResponse.success).toBe(true);
		expect(setResponse.result.ok).toBe(true);

		const showVarsResult = await client.callTool({
			name: 'VariablesStepper-showVars',
			arguments: {
				what: 'testVariable'
			}
		});

		expect(showVarsResult.content).toBeDefined();
		expect(Array.isArray(showVarsResult.content)).toBe(true);
		const displayContent = showVarsResult.content as Array<{ type: string; text: string }>;
		expect(displayContent[0].type).toBe('text');
		const displayResponse = JSON.parse(displayContent[0].text);
		expect(displayResponse.stepName).toBe('showVars');
		expect(displayResponse.stepperName).toBe('VariablesStepper');
		expect(displayResponse.success).toBe(true);
		expect(displayResponse.result.ok).toBe(true);
	});

	it('call compose and showVars variables', async () => {
		// First set two variables to compose
		await client.callTool({
			name: 'VariablesStepper-set',
			arguments: {
				what: 'prefix',
				value: '"wombat"'
			}
		});
		await client.callTool({
			name: 'VariablesStepper-set',
			arguments: {
				what: 'suffix',
				value: '"eucalyptus"'
			}
		});

		const composeResult = await client.callTool({
			name: 'VariablesStepper-compose',
			arguments: {
				what: 'yum',
				template: '{prefix}{suffix}'
			}
		});

		expect(composeResult.content).toBeDefined();
		expect(Array.isArray(composeResult.content)).toBe(true);
		const composeContent = composeResult.content as Array<{ type: string; text: string }>;
		expect(composeContent[0].type).toBe('text');
		const composeResponse = JSON.parse(composeContent[0].text);
		expect(composeResponse.stepName).toBe('compose');
		expect(composeResponse.stepperName).toBe('VariablesStepper');
		expect(composeResponse.success).toBe(true);

		const showVarsResult = await client.callTool({
			name: 'VariablesStepper-showVars',
			arguments: {
				what: 'yum'
			}
		});

		expect(showVarsResult.content).toBeDefined();
		expect(Array.isArray(showVarsResult.content)).toBe(true);
		const displayContent = showVarsResult.content as Array<{ type: string; text: string }>;
		expect(displayContent[0].type).toBe('text');
		const displayResponse = JSON.parse(displayContent[0].text);
		expect(displayResponse.stepName).toBe('showVars');
		expect(displayResponse.stepperName).toBe('VariablesStepper');
		expect(displayResponse.success).toBe(true);
	});

	it('call comment', async () => {
		const commentResult = await client.callTool({
			name: 'Haibun-comment',
			arguments: {
				comment: ';; This is a test comment from MCP'
			}
		});

		expect(commentResult.content).toBeDefined();
		expect(Array.isArray(commentResult.content)).toBe(true);
		const commentContent = commentResult.content as Array<{ type: string; text: string }>;
		expect(commentContent[0].type).toBe('text');
		const commentResponse = JSON.parse(commentContent[0].text);
		expect(commentResponse.stepName).toBe('comment');
		expect(commentResponse.stepperName).toBe('Haibun');
		expect(commentResponse.success).toBe(true);
		expect(commentResponse.result.ok).toBe(true);
	});

	it('can handle tool execution errors gracefully', async () => {
		// Try to call a tool with invalid parameters
		const result = await client.callTool({
			name: 'VariablesStepper-set',
			arguments: {
				// Missing required 'value' parameter
				what: 'incompleteVariable'
			}
		});

		// The tool should return an error response
		expect(result.content).toBeDefined();
		expect(Array.isArray(result.content)).toBe(true);
		const content = result.content as Array<{ type: string; text?: string }>;
		expect(content.length).toBeGreaterThan(0);
		expect(content[0].text).toBeDefined();

		// The error message should contain our validation error
		expect(content[0].text).toContain('Invalid arguments');
	});

});
