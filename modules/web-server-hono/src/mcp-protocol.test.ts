import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { passWithDefaults, DEF_PROTO_OPTIONS } from '@haibun/core/lib/test/lib.js';
import McpStepper from './mcp-stepper.js';
import WebServerStepper from './web-server-stepper.js';
import { AStepper } from '@haibun/core/lib/astepper.js';
import { OK } from '@haibun/core/schema/protocol.js';
import { getStepperOptionName, actionNotOK } from '@haibun/core/lib/util/index.js';

interface ListToolsResult {
  tools: { name: string; description?: string }[];
}

interface CallToolResult {
  content: { type: string; text: string }[];
}

class TestStepper extends AStepper {
  steps = {
    testStep: {
      exact: 'test mcp action',
      action: async () => {
        return OK;
      }
    },
    testStepWithSpaces: {
      gwta: 'test mcp action with { arg }',
      action: async ({ arg }: { arg: string }) => {
        if (arg !== 'spaced') throw Error(`expected spaced, got ${arg}`);
        return OK;
      }
    },
    verifyProtocol: {
      gwta: 'verify mcp protocol on port {port}',
      action: async ({ port }: { port: string }) => {
        const mcpUrl = `http://localhost:${port}/mcp`;
        const client = new Client({ name: 'test-client', version: '1.0' });

        try {
          // Use the official SDK StreamableHTTPClientTransport
          const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
          await client.connect(transport);

          // List tools
          const toolsRes = await client.listTools() as ListToolsResult;
          const toolNames = toolsRes.tools.map((t) => t.name);
          if (!toolNames.includes('TestStepper-testStep')) {
            throw new Error(`Tool not found: ${toolNames.join(', ')}`);
          }
          if (!toolNames.includes('TestStepper-testStepWithSpaces')) {
            throw new Error(`Spaced tool not found`);
          }

          // Call tool
          const callRes = await client.callTool({ name: 'TestStepper-testStep', arguments: {} }) as CallToolResult;
          if (!callRes.content[0].text.includes('"ok": true')) {
            throw new Error(`Tool call failed: ${JSON.stringify(callRes)}`);
          }

          // Regression test for spaces in GWTA placeholders
          const callResSpaces = await client.callTool({
            name: 'TestStepper-testStepWithSpaces',
            arguments: { arg: 'spaced' }
          }) as CallToolResult;
          if (!callResSpaces.content[0].text.includes('"ok": true')) {
            throw new Error(`Spaced tool call failed: ${callResSpaces.content[0].text}`);
          }

          return OK;
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          console.error('TestStepper protocol error:', message);
          return actionNotOK(message);
        } finally {
          await client.close();
        }
      }
    }
  }
}

describe('McpStepper Protocol Conformance', () => {
  it('supports StreamableHTTP protocol flow via SDK client', async () => {
    const port = 8128;
    const feature = {
      path: '/features/test.feature',
      content: `
serve mcp tools at /mcp
webserver is listening
verify mcp protocol on port ${port}
`
    };

    const moduleOptions = {
      [getStepperOptionName(WebServerStepper, 'PORT')]: String(port)
    };

    const result = await passWithDefaults([feature], [WebServerStepper, McpStepper, TestStepper], { ...DEF_PROTO_OPTIONS, moduleOptions });
    if (!result.ok) {
      let errors = '';
      for (const fr of result.featureResults || []) {
        for (const sr of fr.stepResults) {
          if (!sr.ok) {
            errors += `Step FAILED: ${sr.in} - RESULT: ${JSON.stringify(sr, (key, value) => (key === 'world' || key === 'shared') ? undefined : value)}\n`;
          }
        }
      }
      throw new Error(`Feature failed:\n${errors}`);
    }
    expect(result.ok).toBe(true);
  }, 15000);
});
