/**
 * A call over RPC that its step's contract refuses responds with the refusal's statement: the statement in Unicode notation, its
 * verdict, and the triple that determined it, as the RPC protocol's refusal states them, so a caller reads why its call was
 * refused from the response alone.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RPC_PROTOCOL, RpcRefusalSchema, type TRpcRefusal } from "@haibun/core/lib/rpc-wire.js";
import { actualityAt } from "@haibun/core/lib/transport/adapters/rpc-call.js";
import { DEF_PROTO_OPTIONS, freePort, passWithDefaults } from "@haibun/core/lib/test/lib.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/steps/domains/stepper.js";
import { doesntHold, parameter, type TRelation } from "@haibun/core/lib/steps/domains/contract.js";
import { actionNotOK, actionOKWithProducts, getStepperOptionName } from "@haibun/core/lib/domains/util.js";
import { OK, VERDICT, type TStepArgs } from "@haibun/core/lib/domains/protocol.js";
import { DOMAIN_LINK } from "@haibun/core/lib/domains/domains.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import WebServerStepper from "./web-server-stepper.js";

const REVOKED: TRelation = {
	name: "revoked_grant",
	phrase: { holds: "{grant} is revoked", doesntHold: "{grant} isn't revoked" },
	rules: "@prefix h: <https://withhaibun.github.io/ns/> .\n{ ?g h:revoked ?at } => { (?g) <urn:haibun:relation:revoked_grant> true } .",
};
const GrantSchema = z.object({ id: z.string(), revoked: z.string().optional() });
const GRANT_DOMAIN = "rpc-contract-grant";
const DELEGATION_DOMAIN = "rpc-contract-delegation";
/** The grants a call states, by name. */
const GRANTS: Record<string, z.infer<typeof GrantSchema>> = { revoked: { id: "urn:grant:revoked", revoked: "2026-11-01T00:00:00Z" } };
const METHOD = "Delegating-delegate";

/** Delegates from a grant under a contract that requires the grant isn't revoked. */
class Delegating extends AStepper implements IHasCycles {
	description = "Delegates from a grant under a contract that requires the grant isn't revoked.";
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{ selectors: [GRANT_DOMAIN], schema: GrantSchema, description: "A grant a call states" },
				{ selectors: [DELEGATION_DOMAIN], schema: GrantSchema, description: "A delegation from a grant" },
			],
			relations: [REVOKED],
		}),
	};
	steps = {
		delegate: {
			description: TEST_STEP,
			gwta: `delegate from {grant: ${GRANT_DOMAIN}}`,
			contract: { products: DELEGATION_DOMAIN, requires: [doesntHold(REVOKED, parameter("grant"))] },
			action: ({ grant }: { grant: z.infer<typeof GrantSchema> }) => Promise.resolve(actionOKWithProducts({ id: `${grant.id}:delegated` })),
		},
	} as const satisfies TStepperSteps;
}

/** Calls `delegate` over RPC from a revoked grant and holds the refusal the response states. */
class Calling extends AStepper {
	description = "Calls a step over RPC and holds the refusal its response states.";
	refusal: TRpcRefusal | undefined;
	steps = {
		callRevoked: {
			description: TEST_STEP,
			gwta: `call delegate from the revoked grant at {url: ${DOMAIN_LINK}}`,
			action: async ({ url }: TStepArgs) => {
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
	} as const satisfies TStepperSteps;
}

describe("a call over RPC that its step's contract refuses", () => {
	it("responds with the statement that refused it, its verdict and the triple that determined it", { timeout: 120_000 }, async () => {
		const port = await freePort();
		const options = {
			...DEF_PROTO_OPTIONS,
			moduleOptions: {
				[getStepperOptionName(WebServerStepper, "PORT")]: String(port),
				[getStepperOptionName(WebServerStepper, "RPC")]: "true",
				[getStepperOptionName(WebServerStepper, "ALLOW_WITHOUT_DELEGATION")]: "Delegating:delegate",
			},
		};
		const content = `webserver is listening for "rpc-contract-refusal"\ncall delegate from the revoked grant at "http://localhost:${port}/rpc/${METHOD}"`;
		const result = await passWithDefaults([{ path: "/features/rpc-contract-refusal.feature", content }], [WebServerStepper, Delegating, Calling, LogicStepper], options);
		expect(result.ok).toBe(true);
		const calling = result.world.runtime.steppers?.find((stepper) => stepper instanceof Calling);
		const refusal = (calling as Calling).refusal;
		expect(refusal?.error).toContain("its contract requires that grant isn't revoked, which is refuted");
		expect(refusal?.statement?.statement).toBe("grant isn't revoked");
		expect(refusal?.error, "the second sentence is the remedy the verdict determines").toContain(refusal?.statement?.remedy);
		expect(refusal?.statement?.verdict).toBe(VERDICT.refuted);
		expect(refusal?.statement?.decidedBy).toContain("revoked_grant");
	});
});
