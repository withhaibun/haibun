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
import { SHOW_STEPS_METHOD, STEP_DETAIL, readShownSteps } from "@haibun/core/lib/step-discovery.js";
import { runRegistry } from "@haibun/core/lib/step-registry.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

class TestStepper extends AStepper {
	description = "Steps that check the MCP tools a run lists.";
	steps = {
		testA: {
			exact: "test action a",
			action: async () => OK,
		},
		verifyTools: {
			gwta: "verify mcp tools on port {port}",
			action: async ({ port }: { port: string }) => {
				const mcpUrl = `http://localhost:${port}/mcp`;
				const client = new Client({ name: "client", version: "1.0" }, { capabilities: {} });
				try {
					await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: "Bearer test-token" } } }));
					const { tools } = await client.listTools();
					const names = tools.map((tool) => tool.name);
					for (const expected of ["TestStepper-testA", "TestStepper-verifyTools", SHOW_STEPS_METHOD]) {
						if (!names.includes(expected)) throw Error(`${expected} is not listed among ${names.join(", ")}`);
					}
					const verifyTool = tools.find((tool) => tool.name === "TestStepper-verifyTools");
					if (!verifyTool || !(verifyTool.inputSchema as { properties?: Record<string, unknown> }).properties?.port)
						throw Error(`verifyTools lists no port: ${JSON.stringify(verifyTool)}`);
					let listChanged = (): void => undefined;
					const toldOfChange = new Promise<void>((resolve) => (listChanged = resolve));
					client.setNotificationHandler(ToolListChangedNotificationSchema, () => listChanged());
					const registry = runRegistry(this.getWorld());
					const passes = registry.get("TestStepper-testA");
					if (!passes) throw Error("TestStepper-testA is not registered");
					registry.inject([{ ...passes, descriptor: { ...passes.descriptor, method: "Injected-testA", stepperName: "Injected" } }]);
					await toldOfChange;
					if (!(await client.listTools()).tools.some((tool) => tool.name === "Injected-testA"))
						throw Error("a step injected into the run is not listed after the client was told the list changed");
					const instructions = client.getInstructions() ?? "";
					if (!instructions.includes("- TestStepper (2 steps): Steps that check the MCP tools a run lists.")) throw Error(`the instructions name no TestStepper: ${instructions}`);
					const shown = (await client.callTool({ name: SHOW_STEPS_METHOD, arguments: { text: "TestStepper-", detail: STEP_DETAIL.summary } })) as {
						content: Array<{ text: string }>;
					};
					const methods = readShownSteps(JSON.parse(shown.content[0].text), STEP_DETAIL.summary).steps.map((step) => step.method);
					if (methods.join(",") !== "TestStepper-testA,TestStepper-verifyTools") throw Error(`show steps returned ${methods.join(", ")}`);
					const resources = await client.listResources();
					if (!resources.resources.find((r) => r.name === "Haibun MCP Server Info"))
						throw Error(`Missing Haibun MCP Server Info resource. Found: ${resources.resources.map((r) => r.name).join(", ")}`);
				} finally {
					await client.close();
				}
				return OK;
			},
		},
	};
}

describe("McpStepper tools", () => {
	it("states the run's steppers in its instructions, lists every step of the run as a tool, show steps among them, tells a client when the list changes, and calls one", async () => {
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
