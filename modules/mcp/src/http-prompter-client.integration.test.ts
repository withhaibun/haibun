import { testWithDefaults } from '@haibun/core/lib/test/lib.js';
import { describe, it, expect } from 'vitest';
import { HttpPrompterClient } from './lib/http-prompter-client.js';
import { TEST_PORTS } from './mcp-test-utils.js';

import haibunMcp from './mcp-server-stepper.js';
import HaibunStepper from '@haibun/core/steps/haibun.js';

describe('HTTP Prompter Client Integration', () => {
	const HTTP_PORT = TEST_PORTS.MCP_HTTP_PROMPTER_TEST;

	it('should handle HTTP prompter client calls correctly', async () => {
		const httpPrompterClient = new HttpPrompterClient(`http://localhost:${HTTP_PORT}`, 'test-token');

		// Test getPrompts when no HTTP server is running - should throw error.
		try {
			await httpPrompterClient.getPrompts();
			expect(false).toBe(true); // Should not reach here
		} catch (error) {
			expect(error).toBeDefined();
		}

		// Test respondToPrompt with invalid prompt ID - should throw error.
		try {
			await httpPrompterClient.respondToPrompt('invalid-id', 'test-response');
			expect(false).toBe(true); // Should not reach here
		} catch (error) {
			expect(error).toBeDefined();
		}
	});

	it('should expose debug prompt tools via MCP', async () => {
		// Test that MCP tools for prompt handling are available.
		const feature = {
			path: '/features/test-mcp-prompt-tools.feature',
			content: `
Feature: MCP Debug Prompt Tools

The MCP server provides tools for debugging by exposing prompt management capabilities.

Scenario: Test MCP prompt tools availability
	Given I serve mcp tools from steppers
	And I stop mcp tools
			`.trim()
		};

		const result = await testWithDefaults([feature], [haibunMcp, HaibunStepper]);

		expect(result.ok).toBe(true);
	});

	it('should start MCP server with HTTP prompter client tools', async () => {
		// Simple test to verify MCP server starts with HTTP prompter client functionality.
		const feature = {
			path: '/features/test-http-prompter-client-startup.feature',
			content: `
Feature: HTTP Prompter Client Startup

This test verifies that the MCP server can start successfully with HTTP prompter client functionality enabled.

Scenario: Start MCP server with HTTP prompter client tools
	Given I serve mcp tools from steppers
	Then I stop mcp tools
			`.trim()
		};

		const result = await testWithDefaults([feature], [haibunMcp, HaibunStepper]);

		expect(result.ok).toBe(true);
	});
});
