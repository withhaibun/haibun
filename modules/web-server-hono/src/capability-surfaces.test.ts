/**
 * Capability on every call: every step actuality registers is refused to a caller that doesn't hold a capability, through each
 * surface that calls a step. The surfaces are a stepper's own call in process, an RPC call and an MCP tool call.
 */
import { describe, expect, it } from "vitest";
import { passWithDefaults, DEF_PROTO_OPTIONS, freePort } from "@haibun/core/lib/test/lib.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import type { TWorld } from "@haibun/core/lib/actuality/domains/world.js";
import { OK } from "@haibun/core/lib/domains/protocol.js";
import { actionNotOK, getStepperOptionName } from "@haibun/core/lib/domains/util.js";
import { DOMAIN_NUMBER } from "@haibun/core/lib/domains/domains.js";
import { runAuthorizedWith } from "@haibun/core/lib/domains/capability-context.js";
import { runRegistry } from "@haibun/core/lib/steps/pipelines/step-registry.js";
import { callStepFrom } from "@haibun/core/lib/steps/pipelines/call-step.js";
import { refusal } from "@haibun/core/lib/steps/pipelines/gate.js";
import { REFUSED_CALL_STATUS, RPC_PROTOCOL, RefusedCall } from "@haibun/core/lib/rpc-wire.js";
import { actualityAt } from "@haibun/core/lib/transport/adapters/rpc-call.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import McpStepper from "./mcp-stepper.js";
import WebServerStepper from "./web-server-stepper.js";

const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

/** A JSON body posted to `url`, and its parsed response. */
async function posted(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
	const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
	return { status: response.status, data: (await response.json()) as Record<string, unknown> };
}

/** Why a call refused, or undefined where it ran. */
async function refusedFor(call: () => Promise<unknown>): Promise<string | undefined> {
	try {
		await call();
		return undefined;
	} catch (caught) {
		if (caught instanceof RefusedCall) return caught.message;
		throw caught;
	}
}

/** The surfaces through which a caller that doesn't hold a capability calls each registered step, each returning why it refused. */
class SurfacesStepper extends AStepper {
	description = "Calls every registered step through each surface without a capability, for the test of capability on every call.";
	steppers: AStepper[] = [];
	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}
	steps = {
		everyStepRefused: {
			gwta: `every registered step is refused without a capability in process, over rpc and over mcp on port {port: ${DOMAIN_NUMBER}}`,
			action: async ({ port }: { port: number }) => {
				const world = this.getWorld();
				const base = `http://localhost:${port}`;
				const actualityId = await actualityAt(base);
				const mcp = `${base}/mcp`;
				await posted(mcp, MCP_HEADERS, {
					jsonrpc: "2.0",
					id: 0,
					method: "initialize",
					params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "surfaces", version: "1.0" } },
				});
				const unrefused: string[] = [];
				for (const { descriptor } of runRegistry(world).list()) {
					const { method } = descriptor;
					const input = Object.fromEntries(Object.keys(descriptor.paramDomains).map((name) => [name, "x"]));
					const inProcess = await refusedFor(() => runAuthorizedWith(undefined, () => callStepFrom(this, method, input)));
					if (inProcess?.includes(`capability ${descriptor.capability} required`) !== true) unrefused.push(`${method} in process`);
					const rpc = await posted(
						`${base}/rpc/${method}`,
						{ "content-type": "application/json" },
						{ jsonrpc: "2.0", protocol: RPC_PROTOCOL, id: "1", method, params: input, actualityId },
					);
					if (rpc.status !== REFUSED_CALL_STATUS || rpc.data.error !== refusal(method, undefined, undefined).error) unrefused.push(`${method} over rpc`);
					const tool = await posted(mcp, MCP_HEADERS, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: method, arguments: input } });
					if ((tool.data.result as { isError?: boolean } | undefined)?.isError !== true) unrefused.push(`${method} over mcp`);
				}
				return unrefused.length === 0 ? OK : actionNotOK(`calls without a capability ran: ${unrefused.join(", ")}`);
			},
		},
	};
}

describe("capability on every call", () => {
	it("refuses every registered step to a caller without a capability, in process, over RPC and over MCP", { timeout: 60_000 }, async () => {
		const port = await freePort();
		const feature = {
			path: "/features/surfaces.feature",
			content: `serve mcp tools at "/mcp"\nwebserver is listening for "surfaces"\nevery registered step is refused without a capability in process, over rpc and over mcp on port ${port}`,
		};
		const options = {
			...DEF_PROTO_OPTIONS,
			moduleOptions: {
				[getStepperOptionName(WebServerStepper, "PORT")]: String(port),
				[getStepperOptionName(WebServerStepper, "RPC")]: "true",
				[getStepperOptionName(McpStepper, "PORT")]: String(port),
			},
		};
		const result = await passWithDefaults([feature], [WebServerStepper, McpStepper, Haibun, VariablesStepper, ActivitiesStepper, AuthorityStepper, SurfacesStepper], options);
		expect(result.ok).toBe(true);
	});
});
