import { describe, it, expect } from "vitest";

import { passWithDefaults, DEF_PROTO_OPTIONS } from "@haibun/core/lib/test/lib.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { actionOKWithProducts, getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { OK } from "@haibun/core/schema/protocol.js";
import ZcapLikeStepper from "@haibun/core/steps/zcap-like-stepper.js";

import McpStepper from "./mcp-stepper.js";
import WebServerStepper from "./web-server-stepper.js";

class ProtectedStepper extends AStepper {
	steps = {
		protectedAction: {
			exact: "protected mcp action",
			capability: "ProtectedStepper:invoke",
			action: async () => actionOKWithProducts({ protected: true }),
		},
		adminAction: {
			exact: "admin mcp action",
			capability: "ProtectedStepper:admin",
			action: async () => actionOKWithProducts({ admin: true }),
		},
		verifyProtectedMcpDenied: {
			gwta: "verify protected mcp tool on port {port} is denied",
			action: async ({ port }: { port: string }) => {
				const result = await callProtectedTool(String(port));
				const toolResult = getToolResult(result);
				if (!toolResult.isError) {
					throw new Error(`Expected protected tool denial, got ${JSON.stringify(result)}`);
				}
				const text = toolResult.content?.[0]?.type === "text" ? toolResult.content[0].text : "";
				if (!text.includes("capability ProtectedStepper:invoke required")) {
					throw new Error(`Expected capability denial, got ${JSON.stringify(result)}`);
				}
				return OK;
			},
		},
		verifyProtectedMcpAllowed: {
			gwta: "verify protected mcp tool on port {port} succeeds",
			action: async ({ port }: { port: string }) => {
				const result = await callProtectedTool(String(port));
				const toolResult = getToolResult(result);
				if (toolResult.isError) {
					throw new Error(`Expected protected tool success, got ${JSON.stringify(result)}`);
				}
				const text = toolResult.content?.[0]?.type === "text" ? toolResult.content[0].text : "{}";
				const parsed = JSON.parse(text) as { protected?: boolean };
				if (parsed.protected !== true) {
					throw new Error(`Expected protected=true, got ${text}`);
				}
				return OK;
			},
		},
		verifyAdminMcpDenied: {
			gwta: "verify admin mcp tool on port {port} is denied",
			action: async ({ port }: { port: string }) => {
				const result = await callTool(String(port), "ProtectedStepper-adminAction");
				const toolResult = getToolResult(result);
				if (!toolResult.isError) {
					throw new Error(`Expected admin tool denial, got ${JSON.stringify(result)}`);
				}
				const text = toolResult.content?.[0]?.type === "text" ? toolResult.content[0].text : "";
				if (!text.includes("capability ProtectedStepper:admin required")) {
					throw new Error(`Expected admin capability denial, got ${JSON.stringify(result)}`);
				}
				return OK;
			},
		},
	};
}

describe("McpStepper capability enforcement", () => {
	it("denies protected MCP tools when bearer auth has no capability mapping", async () => {
		const port = 8134;
		const feature = {
			path: "/features/mcp-capability-denied.feature",
			content: `
serve mcp tools at /mcp
webserver is listening for "mcp capability denied"
verify protected mcp tool on port ${port} is denied
`,
		};

		const moduleOptions = {
			[getStepperOptionName(WebServerStepper, "PORT")]: String(port),
			[getStepperOptionName(McpStepper, "PORT")]: String(port),
			[getStepperOptionName(McpStepper, "ACCESS_TOKEN")]: "test-token",
		};

		const result = await passWithDefaults([feature], [WebServerStepper, McpStepper, ProtectedStepper], {
			...DEF_PROTO_OPTIONS,
			moduleOptions,
		});
		if (!result.ok) {
			throw new Error(JSON.stringify(result.featureResults, null, 2));
		}
		expect(result.ok).toBe(true);
	});

	it("allows protected MCP tools when bearer auth maps to the required capability", async () => {
		const port = 8135;
		const feature = {
			path: "/features/mcp-capability-allowed.feature",
			content: `
serve mcp tools at /mcp
webserver is listening for "mcp capability allowed"
verify protected mcp tool on port ${port} succeeds
`,
		};

		const moduleOptions = {
			[getStepperOptionName(WebServerStepper, "PORT")]: String(port),
			[getStepperOptionName(McpStepper, "PORT")]: String(port),
			[getStepperOptionName(McpStepper, "ACCESS_TOKEN")]: "test-token",
			[getStepperOptionName(McpStepper, "ACCESS_CAPABILITY")]: "ProtectedStepper:invoke",
		};

		const result = await passWithDefaults([feature], [WebServerStepper, McpStepper, ProtectedStepper], {
			...DEF_PROTO_OPTIONS,
			moduleOptions,
		});
		if (!result.ok) {
			throw new Error(JSON.stringify(result.featureResults, null, 2));
		}
		expect(result.ok).toBe(true);
	});

	it("allows and then revokes protected MCP tools through a zcap-like bearer grant", async () => {
		const port = 8136;
		const feature = {
			path: "/features/mcp-zcap-like-capability.feature",
			content: `
serve mcp tools at /mcp
webserver is listening for "mcp zcap-like capability"
issue zcap-like bearer grant for token "test-token" with capability "ProtectedStepper:invoke"
verify protected mcp tool on port ${port} succeeds
revoke zcap-like bearer grant for token "test-token"
verify protected mcp tool on port ${port} is denied
`,
		};

		const moduleOptions = {
			[getStepperOptionName(WebServerStepper, "PORT")]: String(port),
			[getStepperOptionName(McpStepper, "PORT")]: String(port),
			[getStepperOptionName(McpStepper, "ACCESS_TOKEN")]: "test-token",
		};

		const result = await passWithDefaults([feature], [WebServerStepper, McpStepper, ZcapLikeStepper, ProtectedStepper], {
			...DEF_PROTO_OPTIONS,
			moduleOptions,
		});
		if (!result.ok) {
			throw new Error(JSON.stringify(result.featureResults, null, 2));
		}
		expect(result.ok).toBe(true);
	});

	it("keeps MCP bearer capability mappings least-privilege", async () => {
		const port = 8137;
		const feature = {
			path: "/features/mcp-capability-least-privilege.feature",
			content: `
serve mcp tools at /mcp
webserver is listening for "mcp capability least privilege"
verify protected mcp tool on port ${port} succeeds
verify admin mcp tool on port ${port} is denied
`,
		};

		const moduleOptions = {
			[getStepperOptionName(WebServerStepper, "PORT")]: String(port),
			[getStepperOptionName(McpStepper, "PORT")]: String(port),
			[getStepperOptionName(McpStepper, "ACCESS_TOKEN")]: "test-token",
			[getStepperOptionName(McpStepper, "ACCESS_CAPABILITY")]: "ProtectedStepper:invoke",
		};

		const result = await passWithDefaults([feature], [WebServerStepper, McpStepper, ProtectedStepper], {
			...DEF_PROTO_OPTIONS,
			moduleOptions,
		});
		if (!result.ok) {
			throw new Error(JSON.stringify(result.featureResults, null, 2));
		}
		expect(result.ok).toBe(true);
	});
});

async function callProtectedTool(port: string): Promise<Record<string, unknown>> {
	return await callTool(port, "ProtectedStepper-protectedAction");
}

async function callTool(port: string, toolName: string): Promise<Record<string, unknown>> {
	const mcpUrl = `http://localhost:${port}/mcp`;
	await rpc(mcpUrl, 1, "initialize", {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "capability-client", version: "1.0" },
	});
	await rpc(mcpUrl, 2, "tools/call", {
		name: "access_stepper_ProtectedStepper",
		arguments: {},
	});
	return await rpc(mcpUrl, 3, "tools/call", {
		name: toolName,
		arguments: {},
	});
}

async function rpc(url: string, id: number, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				Authorization: "Bearer test-token",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
		});
	} catch (error) {
		const detail =
			error instanceof Error ? `${error.message}${error.cause ? ` | cause: ${String(error.cause)}` : ""}` : String(error);
		throw new Error(`MCP ${method} fetch failed: ${detail}`);
	}
	if (!response.ok) {
		throw new Error(`MCP ${method} failed: ${response.status} ${await response.text()}`);
	}
	return (await response.json()) as Record<string, unknown>;
}

function getToolResult(response: Record<string, unknown>): {
	isError?: boolean;
	content?: Array<{ type?: string; text?: string }>;
} {
	return ((response.result as Record<string, unknown> | undefined) ?? response) as {
		isError?: boolean;
		content?: Array<{ type?: string; text?: string }>;
	};
}
