/**
 * A call that its step's contract refuses responds with the refusal's statement: the statement in Unicode notation, its verdict,
 * and the triple that determined it. A call over RPC reads it from the RPC protocol's refusal, and a model's tool call over MCP
 * from the failed tool's structured content, so each caller reads the same record of why its call was refused.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RPC_PROTOCOL, RpcRefusalSchema, StatementRefusalSchema, type TRpcRefusal, type TStatementRefusal } from "@haibun/core/lib/rpc-wire.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import McpStepper from "./mcp-stepper.js";
import { actualityAt } from "@haibun/core/lib/transport/adapters/rpc-call.js";
import { DEF_PROTO_OPTIONS, freePort, passWithDefaults } from "@haibun/core/lib/test/lib.js";
import { AStepper, type IHasCycles, type IStepperCycles, declareSteps } from "@haibun/core/lib/steps/domains/stepper.js";
import { doesntHold, parameter } from "@haibun/core/lib/steps/domains/contract.js";
import { GRANT, GrantSchema, REVOKED_GRANT } from "@haibun/core/lib/test/contract-grants.js";
import { actionNotOK, actionOKWithProducts, getStepperOptionName } from "@haibun/core/lib/domains/util.js";
import { OK, VERDICT } from "@haibun/core/lib/domains/protocol.js";
import { DOMAIN_LINK } from "@haibun/core/lib/domains/domains.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import WebServerStepper from "./web-server-stepper.js";

/** A delegation from a grant: its id. */
const DelegationSchema = z.object({ id: z.string() });
const GRANT_DOMAIN = "rpc-contract-grant";
declare module "@haibun/core/lib/domains/domains.js" {
	interface DomainTypes {
		[GRANT_DOMAIN]: z.output<typeof GrantSchema>;
	}
}
const DELEGATION_DOMAIN = "rpc-contract-delegation";
/** The grants a call states, by name. */
const GRANTS: Record<string, z.input<typeof GrantSchema>> = { revoked: { id: "urn:grant:revoked", revoked: "2026-11-01T00:00:00Z" } };
const METHOD = "Delegating-delegate";

/** Delegates from a grant under a contract that requires the grant isn't revoked. */
class Delegating extends AStepper implements IHasCycles {
	description = "Delegates from a grant under a contract that requires the grant isn't revoked.";
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{ selectors: [GRANT_DOMAIN], ...GRANT, description: "A grant a call states" },
				{ selectors: [DELEGATION_DOMAIN], schema: DelegationSchema, description: "A delegation from a grant" },
			],
			relations: [REVOKED_GRANT],
		}),
	};
	steps = declareSteps({
		delegate: {
			description: TEST_STEP,
			gwta: `delegate from {grant: ${GRANT_DOMAIN}}`,
			contract: { products: DELEGATION_DOMAIN, requires: [doesntHold(REVOKED_GRANT, parameter("grant"))] },
			action: ({ grant }) => Promise.resolve(actionOKWithProducts({ id: `${grant.id}:delegated` })),
		},
	});
}

/** Calls `delegate` from a revoked grant over RPC and as a tool call over MCP, and holds the refusal each response states. */
class Calling extends AStepper {
	description = "Calls a step over RPC and as a tool call, and holds the refusal each response states.";
	refusal: TRpcRefusal | undefined;
	toolRefusal: TStatementRefusal | undefined;
	steps = declareSteps({
		callRevoked: {
			description: TEST_STEP,
			gwta: `call delegate from the revoked grant at {url: ${DOMAIN_LINK}}`,
			action: async ({ url }) => {
				const body = {
					jsonrpc: "2.0",
					protocol: RPC_PROTOCOL,
					id: "1",
					method: METHOD,
					params: { grant: GRANTS.revoked },
					actualityId: await actualityAt(new URL(String(url)).origin),
				};
				const response = await fetch(String(url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
				const parsed = RpcRefusalSchema.safeParse(await response.json());
				if (!parsed.success) return actionNotOK(`the response to ${METHOD} doesn't state a refusal: ${parsed.error.message}`);
				this.refusal = parsed.data;
				return OK;
			},
		},
		callRevokedTool: {
			description: TEST_STEP,
			gwta: `call the delegate tool from the revoked grant at {url: ${DOMAIN_LINK}}`,
			action: async ({ url }) => {
				const client = new Client({ name: "contract-refusal", version: "1.0" }, { capabilities: {} });
				await client.connect(new StreamableHTTPClientTransport(new URL(String(url))));
				try {
					const result = CallToolResultSchema.parse(await client.callTool({ name: METHOD, arguments: { grant: GRANTS.revoked } }));
					const parsed = StatementRefusalSchema.safeParse(result.structuredContent);
					if (result.isError !== true || !parsed.success) return actionNotOK(`the tool ${METHOD} doesn't state a refused statement: ${JSON.stringify(result)}`);
					this.toolRefusal = parsed.data;
					return OK;
				} finally {
					await client.close();
				}
			},
		},
	});
}

describe("a call that its step's contract refuses", () => {
	it("responds with the statement that refused it, its verdict and the triple that determined it, the same over RPC and as a tool call", { timeout: 120_000 }, async () => {
		const port = await freePort();
		const options = {
			...DEF_PROTO_OPTIONS,
			moduleOptions: {
				[getStepperOptionName(WebServerStepper, "PORT")]: String(port),
				[getStepperOptionName(WebServerStepper, "RPC")]: "true",
				[getStepperOptionName(McpStepper, "PORT")]: String(port),
				[getStepperOptionName(WebServerStepper, "ALLOW_WITHOUT_DELEGATION")]: "Delegating:delegate",
			},
		};
		const content = [
			'serve mcp tools at "/mcp"',
			'webserver is listening for "contract-refusal"',
			`call delegate from the revoked grant at "http://localhost:${port}/rpc/${METHOD}"`,
			`call the delegate tool from the revoked grant at "http://localhost:${port}/mcp"`,
		].join("\n");
		const result = await passWithDefaults([{ path: "/features/contract-refusal.feature", content }], [WebServerStepper, McpStepper, Delegating, Calling, LogicStepper], options);
		expect(result.ok).toBe(true);
		const calling = result.world.runtime.steppers?.find((stepper) => stepper instanceof Calling);
		const refusal = (calling as Calling).refusal;
		expect(refusal?.error).toContain("its contract requires that didn't grant is revoked, which is refuted");
		expect(refusal?.statement?.statement).toBe("didn't grant is revoked");
		expect(refusal?.error, "the second sentence is the remedy the verdict determines").toContain(refusal?.statement?.remedy);
		expect(refusal?.statement?.verdict).toBe(VERDICT.refuted);
		expect(refusal?.statement?.decidedBy).toContain("revoked_grant");
		expect((calling as Calling).toolRefusal, "a tool call reads the same record as an RPC call").toEqual(refusal?.statement);
	});
});
