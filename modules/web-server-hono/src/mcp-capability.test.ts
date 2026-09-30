import { describe, it, expect } from "vitest";

import { passWithDefaults, DEF_PROTO_OPTIONS } from "@haibun/core/lib/test/lib.js";
import { TEST_DOMAIN, declaresTestDomains } from "@haibun/core/lib/test/test-domains.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { actionOKWithProducts, getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { OK } from "@haibun/core/schema/protocol.js";
import { readingAt } from "@haibun/core/lib/capability-context.js";
import { refusal } from "@haibun/core/lib/step-registry.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import FakeAuthorityStepper, { DOMAIN_FAKE_HOLDER, FakeInvoker } from "@haibun/core/lib/test/fake-authority.js";

import McpStepper from "./mcp-stepper.js";
import WebServerStepper from "./web-server-stepper.js";
import { DOMAIN_NUMBER } from "@haibun/core/lib/domains.js";

class ProtectedStepper extends AStepper {
	description = "Steps gated by a protected and an admin capability, for tests of MCP authorization.";
	cycles = declaresTestDomains();
	steps = {
		protectedAction: {
			exact: "protected mcp action",
			capability: "ProtectedStepper:invoke",
			action: async () => OK,
		},
		adminAction: {
			exact: "admin mcp action",
			capability: "ProtectedStepper:admin",
			action: async () => OK,
		},
		readsAt: {
			exact: "mcp read level",
			read: true,
			productsDomain: TEST_DOMAIN.readAt,
			action: async () => actionOKWithProducts({ at: readingAt() ?? "unbounded" }),
		},
		verifyMcpReadLevel: {
			gwta: `verify mcp read signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}} on port {port: ${DOMAIN_NUMBER}} reads at {level: ${TEST_DOMAIN.accessLevel}}`,
			action: async ({ holder, action, port, level }: { holder: string; action: string; port: string; level: string }) => {
				const toolResult = getToolResult(await callTool(String(port), "ProtectedStepper-readsAt", { holder, action }));
				const text = toolResult.content?.[0]?.text ?? "";
				if (toolResult.isError || JSON.parse(text).at !== level) throw new Error(`Expected a read at ${level}, got ${text}`);
				return OK;
			},
		},
		verifyProtectedMcpDenied: {
			gwta: `verify protected mcp tool on port {port: ${DOMAIN_NUMBER}} is denied`,
			action: async ({ port }: { port: string }) => {
				// A client that doesn't present authority gets an empty tool list, and is refused alike a tool that exists and one that doesn't.
				const listed = (await rpc(`http://localhost:${port}/mcp`, 2, "tools/list", {})).result as { tools?: unknown[] } | undefined;
				if (listed?.tools?.length !== 0) throw new Error(`Expected no tools listed, got ${JSON.stringify(listed)}`);
				for (const tool of ["ProtectedStepper-protectedAction", "Nowhere-nothing"]) {
					const toolResult = getToolResult(await callTool(String(port), tool));
					const text = toolResult.content?.[0]?.type === "text" ? toolResult.content[0].text : "";
					if (!toolResult.isError || text !== refusal(tool, undefined, undefined)) throw new Error(`Expected ${tool} refused alike, got ${JSON.stringify(toolResult)}`);
				}
				return OK;
			},
		},
		verifySignedProtectedMcpAllowed: {
			gwta: `verify protected mcp tool signed by {holder: ${DOMAIN_FAKE_HOLDER}} on port {port: ${DOMAIN_NUMBER}} succeeds`,
			action: async ({ holder, port }: { holder: string; port: string }) => {
				const result = await callTool(String(port), "ProtectedStepper-protectedAction", { holder, action: "ProtectedStepper:invoke" });
				const toolResult = getToolResult(result);
				if (toolResult.isError) throw new Error(`Expected signed protected tool success, got ${JSON.stringify(result)}`);
				return OK;
			},
		},
		verifySignedMcpTamperedRefused: {
			gwta: `verify protected mcp tool signed by {holder: ${DOMAIN_FAKE_HOLDER}} on port {port: ${DOMAIN_NUMBER}} is refused when its body is not the one signed`,
			action: async ({ holder, port }: { holder: string; port: string }) => {
				const url = `http://localhost:${port}/mcp`;
				await rpc(url, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "capability-client", version: "1.0" } });
				const signedBody = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ProtectedStepper-protectedAction", arguments: {} } });
				const headers = await new FakeInvoker(holder).sign({ method: "POST", url, headers: MCP_HEADERS, body: signedBody }, "ProtectedStepper:invoke");
				const sent = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ProtectedStepper-adminAction", arguments: {} } });
				const response = await fetch(url, { method: "POST", headers, body: sent });
				const text = await response.text();
				if (response.status !== 401 || !text.includes("the presented digest is not of this request's body")) throw new Error(`Expected refusal, got ${response.status} ${text}`);
				return OK;
			},
		},
		verifyAdminMcpDenied: {
			gwta: `verify admin mcp tool signed by {holder: ${DOMAIN_FAKE_HOLDER}} for {action: ${TEST_DOMAIN.action}} on port {port: ${DOMAIN_NUMBER}} is denied`,
			action: async ({ holder, action, port }: { holder: string; action: string; port: string }) => {
				const result = await callTool(String(port), "ProtectedStepper-adminAction", { holder, action });
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

const mcpOptions = (port: number) => ({
	...DEF_PROTO_OPTIONS,
	moduleOptions: { [getStepperOptionName(WebServerStepper, "PORT")]: String(port), [getStepperOptionName(McpStepper, "PORT")]: String(port) },
});

const signedSteppers = [WebServerStepper, McpStepper, AuthorityStepper, FakeAuthorityStepper, ProtectedStepper];

describe("McpStepper capability enforcement", () => {
	it("denies a protected tool to a caller that doesn't present authority", async () => {
		const port = 8134;
		const feature = {
			path: "/features/mcp-capability-denied.feature",
			content: `
serve mcp tools at "/mcp"
webserver is listening for "mcp capability denied"
verify protected mcp tool on port ${port} is denied
`,
		};
		const result = await passWithDefaults([feature], [WebServerStepper, McpStepper, ProtectedStepper], mcpOptions(port));
		if (!result.ok) throw new Error(JSON.stringify(result.featureResults, null, 2));
		expect(result.ok).toBe(true);
	});

	it("runs a signed call under what its request presented, verified over the whole request, body included", async () => {
		const port = 8139;
		const feature = {
			path: "/features/mcp-capability-signed.feature",
			content: `
serve mcp tools at "/mcp"
webserver is listening for "mcp capability signed"
accept authority from "agent" for "ProtectedStepper:invoke"
verify protected mcp tool signed by "agent" on port ${port} succeeds
verify protected mcp tool signed by "agent" on port ${port} is refused when its body is not the one signed
`,
		};
		const result = await passWithDefaults([feature], [WebServerStepper, McpStepper, AuthorityStepper, FakeAuthorityStepper, ProtectedStepper], mcpOptions(port));
		if (!result.ok) throw new Error(JSON.stringify(result.featureResults, null, 2));
		expect(result.ok).toBe(true);
	});

	it("bounds what a call reads by the broadest read its caller holds, as it does over every transport", async () => {
		const port = 8141;
		const feature = {
			path: "/features/mcp-read-ceiling.feature",
			content: `
serve mcp tools at "/mcp"
webserver is listening for "mcp read ceiling"
accept authority from "reader" for "Read:public"
accept authority from "owner" for "Read:private"
verify mcp read signed by "reader" for "Read:public" on port ${port} reads at "public"
verify mcp read signed by "owner" for "Read:private" on port ${port} reads at "private"
`,
		};
		const result = await passWithDefaults([feature], signedSteppers, mcpOptions(port));
		if (!result.ok) throw new Error(JSON.stringify(result.featureResults, null, 2));
		expect(result.ok).toBe(true);
	});

	it("keeps what a signed caller may do least-privilege: a verified action opens only the tools that take it", async () => {
		const port = 8137;
		const feature = {
			path: "/features/mcp-capability-least-privilege.feature",
			content: `
serve mcp tools at "/mcp"
webserver is listening for "mcp capability least privilege"
accept authority from "agent" for "ProtectedStepper:invoke"
verify protected mcp tool signed by "agent" on port ${port} succeeds
verify admin mcp tool signed by "agent" for "ProtectedStepper:invoke" on port ${port} is denied
`,
		};
		const result = await passWithDefaults([feature], [WebServerStepper, McpStepper, AuthorityStepper, FakeAuthorityStepper, ProtectedStepper], mcpOptions(port));
		if (!result.ok) throw new Error(JSON.stringify(result.featureResults, null, 2));
		expect(result.ok).toBe(true);
	});
});

/** A call signed by `holder` for `action`, where one is given; otherwise one that doesn't present authority. */
type TSigned = { holder: string; action: string };

const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

async function callTool(port: string, toolName: string, signed?: TSigned): Promise<Record<string, unknown>> {
	const mcpUrl = `http://localhost:${port}/mcp`;
	await rpc(mcpUrl, 1, "initialize", {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "capability-client", version: "1.0" },
	});
	return await rpc(mcpUrl, 2, "tools/call", { name: toolName, arguments: {} }, signed);
}

async function rpc(url: string, id: number, method: string, params: Record<string, unknown>, signed?: TSigned): Promise<Record<string, unknown>> {
	const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
	const headers = signed ? await new FakeInvoker(signed.holder).sign({ method: "POST", url, headers: MCP_HEADERS, body }, signed.action) : MCP_HEADERS;
	let response: Response;
	try {
		response = await fetch(url, { method: "POST", headers, body });
	} catch (error) {
		const detail = error instanceof Error ? `${error.message}${error.cause ? ` | cause: ${String(error.cause)}` : ""}` : String(error);
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
