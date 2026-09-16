import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { passWithDefaults, DEF_PROTO_OPTIONS } from "@haibun/core/lib/test/lib.js";
import McpStepper from "./mcp-stepper.js";
import WebServerStepper from "./web-server-stepper.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { OK } from "@haibun/core/schema/protocol.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/steps-query.js";
import type { StepDiscovery } from "@haibun/core/lib/step-registry.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const EventSourceRaw = require("eventsource");

// Polyfill extraction
let EventSourcePolyfill = EventSourceRaw.default || EventSourceRaw;
if (typeof EventSourcePolyfill !== "function" && EventSourcePolyfill.EventSource) {
	EventSourcePolyfill = EventSourcePolyfill.EventSource;
}

// Polyfill EventSource for Node environment
global.EventSource = EventSourcePolyfill;

/** What the EventSource polyfill takes beside a URL: the headers it sends. */
type TEventSourceOptions = { headers?: Record<string, string> };

class TestStepper extends AStepper {
	steps = {
		testA: {
			exact: "test action a",
			action: async () => OK,
		},
		verifyTools: {
			gwta: "verify mcp tools on port {port}",
			action: async ({ port }: { port: string }) => {
				const mcpUrl = `http://localhost:${port}/mcp`;
				const originalFetch = global.fetch;
				const previousEventSource = global.EventSource;
				global.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
					if (input.toString().includes("/mcp")) {
						const headers = new Headers(init?.headers);
						headers.set("Authorization", "Bearer test-token");
						return originalFetch(input, { ...init, headers });
					}
					return originalFetch(input, init);
				}) as typeof fetch;
				const Polyfill = EventSourcePolyfill as new (url: string, options?: TEventSourceOptions) => EventSource;
				global.EventSource = class extends Polyfill {
					constructor(url: string, options?: TEventSourceOptions) {
						super(url, { ...options, headers: { ...options?.headers, Authorization: "Bearer test-token" } });
					}
				} as unknown as typeof EventSource;
				const client = new Client({ name: "client", version: "1.0" }, { capabilities: {} });
				try {
					await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
					const { tools } = await client.listTools();
					const names = tools.map((tool) => tool.name);
					for (const expected of ["TestStepper-testA", "TestStepper-verifyTools", SHOW_STEPS_METHOD]) {
						if (!names.includes(expected)) throw Error(`${expected} is not listed among ${names.join(", ")}`);
					}
					const verifyTool = tools.find((tool) => tool.name === "TestStepper-verifyTools");
					if (!verifyTool || !(verifyTool.inputSchema as { properties?: Record<string, unknown> }).properties?.port) throw Error(`verifyTools lists no port: ${JSON.stringify(verifyTool)}`);
					const shown = (await client.callTool({ name: SHOW_STEPS_METHOD, arguments: { pattern: "^TestStepper-", limit: 5 } })) as { content: Array<{ text: string }> };
					const methods = (JSON.parse(shown.content[0].text) as StepDiscovery).steps.map((step) => step.method);
					if (methods.join(",") !== "TestStepper-testA,TestStepper-verifyTools") throw Error(`show steps returned ${methods.join(", ")}`);
					const resources = await client.listResources();
					if (!resources.resources.find((r) => r.name === "Haibun MCP Server Info")) throw Error(`Missing Haibun MCP Server Info resource. Found: ${resources.resources.map((r) => r.name).join(", ")}`);
				} finally {
					await client.close();
					global.fetch = originalFetch;
					global.EventSource = previousEventSource;
				}
				return OK;
			},
		},
	};
}

describe("McpStepper tools", () => {
	it("lists every step of the run as a tool, show steps among them, and calls one", async () => {
		const port = 8130;
		const feature = {
			path: "/features/tools.feature",
			content: `
serve mcp tools at /mcp
verify mcp tools on port ${port}
`,
		};

		const moduleOptions = {
			[getStepperOptionName(WebServerStepper, "PORT")]: String(port),
			[getStepperOptionName(McpStepper, "PORT")]: String(port),
			[getStepperOptionName(McpStepper, "ACCESS_TOKEN")]: "test-token",
		};

		const result = await passWithDefaults([feature], [WebServerStepper, McpStepper, TestStepper, Haibun], {
			...DEF_PROTO_OPTIONS,
			moduleOptions,
		});

		if (!result.ok) {
			throw new Error(JSON.stringify(result.featureResults, null, 2));
		}
		expect(result.ok).toBe(true);
	});
});
