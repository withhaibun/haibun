import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { passWithDefaults, DEF_PROTO_OPTIONS } from "@haibun/core/lib/test/lib.js";
import McpStepper from "./mcp-stepper.js";
import WebServerStepper from "./web-server-stepper.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { OK } from "@haibun/core/schema/protocol.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const EventSourceRaw = require("eventsource");

// Robust polyfill extraction
let EventSourcePolyfill = EventSourceRaw.default || EventSourceRaw;
if (typeof EventSourcePolyfill !== "function" && EventSourcePolyfill.EventSource) {
	EventSourcePolyfill = EventSourcePolyfill.EventSource;
}

// Polyfill EventSource for Node environment
global.EventSource = EventSourcePolyfill;

class TestStepper extends AStepper {
	steps = {
		testA: {
			exact: "test action a",
			action: async () => OK,
		},
		verifySessions: {
			gwta: "verify mcp sessions on port {port}",
			action: async ({ port }: { port: string }) => {
				const mcpUrl = `http://localhost:${port}/mcp`;

				// Monkey-patch fetch and EventSource to inject Auth
				const originalFetch = global.fetch;
				const previousEventSource = global.EventSource;

				global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
					const urlStr = input.toString();
					if (urlStr.includes("/mcp")) {
						init = init || {};
						const headers = new Headers(init.headers);
						headers.set("Authorization", "Bearer test-token");

						// Inject Session ID if present in query
						const urlObj = new URL(urlStr);
						const clientId = urlObj.searchParams.get("clientId");
						if (clientId) {
							headers.set("X-Session-ID", `session-${clientId}`);
						}

						init.headers = headers;
					}
					return originalFetch(input, init);
				}) as any;

				global.EventSource = class extends (EventSourcePolyfill as any) {
					constructor(url: string, options: any) {
						const newOptions = { ...options, headers: { ...options?.headers, Authorization: "Bearer test-token" } };
						// Also inject session ID for EventSource if needed
						if (url.includes("clientId=")) {
							const u = new URL(url);
							const clientId = u.searchParams.get("clientId");
							if (clientId) {
								newOptions.headers["X-Session-ID"] = `session-${clientId}`;
							}
						}
						super(url, newOptions);
					}
				} as any;

				try {
					// Setup Client 1
					const url1 = `${mcpUrl}?clientId=1`;
					const transport1 = new StreamableHTTPClientTransport(new URL(url1));
					const client1 = new Client({ name: "client1", version: "1.0" }, { capabilities: {} });
					await client1.connect(transport1);

					// Setup Client 2
					const url2 = `${mcpUrl}?clientId=2`;
					const transport2 = new StreamableHTTPClientTransport(new URL(url2));
					const client2 = new Client({ name: "client2", version: "1.0" }, { capabilities: {} });
					await client2.connect(transport2);

					// 1. Initial State: Both should see Index
					const tools1 = await client1.listTools();
					const tools2 = await client2.listTools();

					const stepperToolName = "access_stepper_TestStepper";

					if (!tools1.tools.find((t) => t.name === stepperToolName)) {
						throw Error(`Client 1 should see ${stepperToolName} in index. Found: ${tools1.tools.map((t) => t.name).join(", ")}`);
					}

					// 2. Client 1 switches focus
					await client1.callTool({ name: stepperToolName, arguments: {} });

					// 3. Verify Client 1 sees stepper tools
					const tools1After = await client1.listTools();
					if (!tools1After.tools.find((t) => t.name === "TestStepper-testA")) {
						throw Error(
							`Client 1 should see TestStepper tools after switching. Found: ${tools1After.tools.map((t) => t.name).join(", ")}`,
						);
					}

					// 4. Verify Client 2 still sees index (Isolation)
					const tools2After = await client2.listTools();
					if (tools2After.tools.find((t) => t.name === "TestStepper-testA")) {
						throw Error(
							`Client 2 should NOT see TestStepper tools (session isolation failed). Found: ${tools2After.tools.map((t) => t.name).join(", ")}`,
						);
					}
					if (!tools2After.tools.find((t) => t.name === stepperToolName)) {
						throw Error(`Client 2 should still see index. Found: ${tools2After.tools.map((t) => t.name).join(", ")}`);
					}

					// 5. Verify generic navigation: Return to index
					await client1.callTool({ name: "return_to_index", arguments: {} });
					const tools1Back = await client1.listTools();
					if (!tools1Back.tools.find((t) => t.name === stepperToolName)) {
						throw Error(
							`Client 1 should see index after return_to_index. Found: ${tools1Back.tools.map((t) => t.name).join(", ")}`,
						);
					}

					// 6. Verify Resources
					const resources = await client1.listResources();
					if (!resources.resources.find((r) => r.name === "Haibun MCP Server Info")) {
						throw Error(`Missing Haibun MCP Server Info resource. Found: ${resources.resources.map((r) => r.name).join(", ")}`);
					}

					// 6. Verify Tool Parameters
					const toolA = tools1After.tools.find((t) => t.name === "TestStepper-testA");
					if (!toolA) throw Error("Could not find toolA");

					// Verify verifySessions tool exists and has schema
					const verifyTool = tools1After.tools.find((t) => t.name === "TestStepper-verifySessions");
					if (!verifyTool) throw Error("Could not find verifySessions tool");
					const schema = verifyTool.inputSchema as any;
					if (!schema.properties?.port) {
						throw Error(`verifySessions tool missing 'port' property in schema: ${JSON.stringify(schema)}`);
					}

					// Cleanup
					await client1.close();
					await client2.close();
				} catch (e: any) {
					throw new Error(`Session verification failed: ${e.message}\nStack: ${e.stack}`);
				} finally {
					global.fetch = originalFetch;
					global.EventSource = previousEventSource;
				}

				return OK;
			},
		},
	};
}

describe("McpStepper Session Management", () => {
	it("handles multiple sessions independenty", async () => {
		const port = 8130;
		const feature = {
			path: "/features/session.feature",
			content: `
serve mcp tools at /mcp
verify mcp sessions on port ${port}
`,
		};

		const moduleOptions = {
			[getStepperOptionName(WebServerStepper, "PORT")]: String(port),
			[getStepperOptionName(McpStepper, "PORT")]: String(port),
			[getStepperOptionName(McpStepper, "ACCESS_TOKEN")]: "test-token",
		};

		const result = await passWithDefaults([feature], [WebServerStepper, McpStepper, TestStepper], {
			...DEF_PROTO_OPTIONS,
			moduleOptions,
		});

		if (!result.ok) {
			throw new Error(JSON.stringify(result.featureResults, null, 2));
		}
		expect(result.ok).toBe(true);
	});
});
