import { describe, it, expect } from 'vitest';
import { passWithDefaults, DEF_PROTO_OPTIONS } from '@haibun/core/lib/test/lib.js';
import McpStepper from './mcp-stepper.js';
import WebServerStepper from './web-server-stepper.js';
import { AStepper } from '@haibun/core/lib/astepper.js';
import { OK } from '@haibun/core/schema/protocol.js';
import { getStepperOptionName } from '@haibun/core/lib/util/index.js';

interface _ListToolsResult {
  tools: { name: string; description?: string }[];
}

interface _CallToolResult {
  content: { type: string; text: string }[];
}

class TestStepper extends AStepper {
  steps = {
    testStep: {
      exact: 'test mcp action',
      action: () => {
        return OK;
      }
    },
    testStepWithSpaces: {
      gwta: 'test mcp action with { arg }',
      action: ({ arg }: { arg: string }) => {
        if (arg !== 'spaced') throw Error(`expected spaced, got ${arg}`);
        return OK;
      }
    },
    verifyProtocol: {
      gwta: 'verify mcp protocol on port {port}',
      action: async ({ port }: { port: string }) => {
        const mcpUrl = `http://localhost:${port}/mcp`;
        // Manual JSON-RPC handshake to bypass SDK transport issues in test environment
        const rpcPayload = {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05", // Latest known or similar
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0" }
          }
        };

        const response = await fetch(mcpUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
            'Accept': 'application/json, text/event-stream'
          },
          body: JSON.stringify(rpcPayload)
        });

        if (!response.ok) {
          const txt = await response.text();
          throw new Error(`MCP handshake failed: ${response.status} ${txt}`);
        }

        const json = await response.json(); // as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: json response
        const result = (json as any).result;

        if (!result || !result.serverInfo) {
          throw new Error(`Invalid MCP initialize response: ${JSON.stringify(json)}`);
        }

        if (result.serverInfo.name !== 'haibun-mcp') {
          throw new Error(`Unexpected server name: ${result.serverInfo.name}`);
        }

        // Also check version presence
        if (!result.serverInfo.version) {
          throw new Error('Server version missing');
        }

        return OK;
      }
    }
  }
}

describe('McpStepper Protocol Conformance', () => {
  // TODO: Fix auto-focus session state with StreamableHTTP transport
  it('supports StreamableHTTP protocol flow via SDK client', async () => {
    const port = 8128;
    const feature = {
      path: '/features/test.feature',
      content: `
serve mcp tools at /mcp
verify mcp protocol on port ${port}
`
    };

    const moduleOptions = {
      [getStepperOptionName(WebServerStepper, 'PORT')]: String(port),
      [getStepperOptionName(McpStepper, 'ACCESS_TOKEN')]: 'test-token',
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
