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
		expect(tools.some(t => t.name === 'VariablesStepper-display')).toBe(true);

		// Should have utility tools
		expect(tools.some(t => t.name === 'Haibun-pauseSeconds')).toBe(true);
	});

	it('can execute variable setting and display tools', async () => {
		// Set a variable using the VariablesStepper-set tool
		const setResult = await client.callTool({
			name: 'VariablesStepper-set',
			arguments: {
				what: 'testVariable',
				value: 'Hello from MCP'
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

		// Display the variable using the VariablesStepper-display tool
		const displayResult = await client.callTool({
			name: 'VariablesStepper-display',
			arguments: {
				what: 'testVariable'
			}
		});

		expect(displayResult.content).toBeDefined();
		expect(Array.isArray(displayResult.content)).toBe(true);
		const displayContent = displayResult.content as Array<{ type: string; text: string }>;
		expect(displayContent[0].type).toBe('text');
		const displayResponse = JSON.parse(displayContent[0].text);
		expect(displayResponse.stepName).toBe('display');
		expect(displayResponse.stepperName).toBe('VariablesStepper');
		expect(displayResponse.success).toBe(true);
		expect(displayResponse.result.ok).toBe(true);
	});

	it('call combine and display variables', async () => {
		const combineResult = await client.callTool({
			name: 'VariablesStepper-combine',
			arguments: {
				p1: 'wombat',
				p2: 'eucalyptus',
				what: 'yum'
			}
		});

		expect(combineResult.content).toBeDefined();
		expect(Array.isArray(combineResult.content)).toBe(true);
		const combineContent = combineResult.content as Array<{ type: string; text: string }>;
		expect(combineContent[0].type).toBe('text');
		const combineResponse = JSON.parse(combineContent[0].text);
		expect(combineResponse.stepName).toBe('combine');
		expect(combineResponse.stepperName).toBe('VariablesStepper');
		expect(combineResponse.success).toBe(true);

		const displayResult = await client.callTool({
			name: 'VariablesStepper-display',
			arguments: {
				what: 'yum'
			}
		});

		expect(displayResult.content).toBeDefined();
		expect(Array.isArray(displayResult.content)).toBe(true);
		const displayContent = displayResult.content as Array<{ type: string; text: string }>;
		expect(displayContent[0].type).toBe('text');
		const displayResponse = JSON.parse(displayContent[0].text);
		expect(displayResponse.stepName).toBe('display');
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
		try {
			await client.callTool({
				name: 'VariablesStepper-set',
				arguments: {
					// Missing required 'value' parameter
					what: 'incompleteVariable'
				}
			});

			// If we get here, the call succeeded when it should have failed
			expect.fail('Expected tool call to throw an error due to missing required parameter');
		} catch (error) {
			// This is the expected behavior - the tool should throw/error on invalid parameters
			expect(error).toBeDefined();
			expect(error.message).toContain('Invalid arguments');
		}
	});

});
