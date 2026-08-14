/**
 * Signed-capability path of AuthorityStepper: `as subkey holding capability {cap} at {target}, {what}`.
 * Mirrors the bearer `as subkey` attribution test, but the principal is proven by a *signed* capability
 * verified through a registered IAuthorityVerifier (a test double here — haibun-core stays crypto-free; the
 * ZCAP-LD verifier lives in the consumer). On verified, the capability's controller becomes the
 * principal so authored writes are attributed to it.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getDefaultWorld, testWithWorld } from "../lib/test/lib.js";
import { resolveSitePrincipal } from "../lib/host-id.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "../lib/astepper.js";
import { COMMENT_LABEL, LinkRelations, type TDomainDefinition } from "../lib/resources.js";
import { getAuthority } from "../lib/session-authority.js";
import type { IAuthorityVerifier, TAuthorityEvidence } from "../lib/authority-types.js";
import AuthorityStepper from "./authority-stepper.js";
import ResourcesStepper from "./resources-stepper.js";
import VariablesStepper from "./variables-stepper.js";

const TEST_NODE_LABEL = "TestNode";
const testNodeDomain: TDomainDefinition = {
	selectors: ["test-node"],
	schema: z.object({ id: z.string() }),
	description: "Minimal persisted type for signed-capability attribution tests",
	topology: { persistedAs: TEST_NODE_LABEL, id: "id", properties: { id: LinkRelations.IDENTIFIER.rel } },
};

class TestNodeStepper extends AStepper implements IHasCycles {
	cycles: IStepperCycles = { getConcerns: () => ({ domains: [testNodeDomain] }) };
	steps = {};
}

/** Captures what the registered verifier was asked to verify, and decides ok/fail. Registered after AuthorityStepper installs the authority. */
const verifierState: { lastEvidence?: TAuthorityEvidence; ok: boolean; error?: string } = { ok: true };

class StubVerifierStepper extends AStepper implements IHasCycles {
	cycles: IStepperCycles = {
		startFeature: () => {
			const verifier: IAuthorityVerifier = {
				verify: (evidence) => {
					verifierState.lastEvidence = evidence;
					return Promise.resolve(verifierState.ok ? { ok: true } : { ok: false, error: verifierState.error ?? "bad signature" });
				},
			};
			getAuthority(this.getWorld().runtime)?.registerVerifier(verifier);
		},
	};
	steps: TStepperSteps = {};
}

const SUBKEY_DID = "did:site:0:alice";
const CAP_JSON = JSON.stringify({
	id: "urn:zcap:alice-comment",
	controller: SUBKEY_DID,
	invocationTarget: "urn:res:1",
	allowedAction: "ResourcesStepper:comment",
	parentCapability: "urn:zcap:root:res:1",
	proof: { type: "DataIntegrityProof", verificationMethod: `${SUBKEY_DID}#key-1`, proofValue: "z-stub-signature" },
});

const STEPPERS = [AuthorityStepper, StubVerifierStepper, ResourcesStepper, TestNodeStepper, VariablesStepper];

describe("AuthorityStepper signed-capability path", () => {
	it("attributes authored writes inside `as subkey holding capability` to the verified capability's controller", async () => {
		verifierState.ok = true;
		verifierState.lastEvidence = undefined;
		const world = getDefaultWorld({ HAIBUN_LOG_LEVEL: "none" });
		world.runtime.keys = { ...world.runtime.keys, principal: resolveSitePrincipal({}) };

		const feature = {
			path: "/features/authority-signed-capability.feature",
			content: `
set cap as json to ${CAP_JSON}
as subkey holding capability cap at "urn:res:1", comment on "${TEST_NODE_LABEL}" node-1 with "hi from the capability holder"
`,
		};

		const result = await testWithWorld(world, [feature], STEPPERS);
		if (!result.ok) {
			const steps = result.featureResults?.flatMap((fr) => fr.stepResults.map((sr) => `${sr.in}: ${sr.ok}${sr.ok ? "" : ` — ${JSON.stringify(sr.actionResults)}`}`)) ?? [];
			throw new Error(`failure: ${result.failure?.error?.message ?? "none"}\n${steps.join("\n")}`);
		}
		expect(result.ok).toBe(true);

		const store = world.shared.getStore();
		const comments = await store.queryIndividuals<{ id: string; author: string }>(COMMENT_LABEL);
		expect(comments.length).toBe(1);
		expect(comments[0].author).toBe(SUBKEY_DID);

		expect(verifierState.lastEvidence?.action, "the verifier is told what was asked for").toBe("ResourcesStepper:comment");
		expect(verifierState.lastEvidence?.target, "and what it was asked of").toBe("urn:res:1");
		expect(verifierState.lastEvidence?.document.id, "and is handed the document itself to read").toBe("urn:zcap:alice-comment");
	});

	it("fails the step (and writes nothing) when the registered verifier rejects the signed capability", async () => {
		verifierState.ok = false;
		verifierState.error = "invalid proof";
		const world = getDefaultWorld({ HAIBUN_LOG_LEVEL: "none" });
		world.runtime.keys = { ...world.runtime.keys, principal: resolveSitePrincipal({}) };

		const feature = {
			path: "/features/authority-signed-capability-fail.feature",
			content: `
set cap as json to ${CAP_JSON}
as subkey holding capability cap at "urn:res:1", comment on "${TEST_NODE_LABEL}" node-1 with "should never be written"
`,
		};

		const result = await testWithWorld(world, [feature], STEPPERS);
		expect(result.ok).toBe(false);

		const store = world.shared.getStore();
		const comments = await store.queryIndividuals<{ id: string; author: string }>(COMMENT_LABEL);
		expect(comments.length).toBe(0);
	});
});
