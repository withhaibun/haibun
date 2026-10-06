/**
 * Signed-capability path of AuthorityStepper: `holding capability {cap} at {target}, {what}`. The principal is
 * proven by a signed capability verified through a registered IAuthorityVerifier (a test double here, haibun-core
 * stays crypto-free; the ZCAP-LD verifier lives in the consumer). On verified, the capability's controller becomes the
 * principal so authored writes are attributed to it.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getDefaultWorld, testWithWorld } from "../lib/test/lib.js";
import { resolveSitePrincipal } from "../lib/host-id.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "../lib/astepper.js";
import { COMMENT_LABEL, LinkRelations, type TDomainDefinition } from "../lib/resources.js";
import { getAuthority } from "../lib/session-authority.js";
import type { TAuthorityEvidence } from "../lib/authority-types.js";
import { stubVerifier } from "../lib/test/fake-authority.js";
import { itemAt } from "../lib/util/item-at.js";
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
	description = "Declares a minimal persisted type for attribution tests.";
	cycles: IStepperCycles = { getConcerns: () => ({ domains: [testNodeDomain] }) };
	steps = {};
}

/** Captures what the registered verifier was asked to verify, and decides ok/fail. Registered after AuthorityStepper installs the authority. */
const verifierState: { lastEvidence?: TAuthorityEvidence; ok: boolean; error?: string } = { ok: true };
/** States what the verifier decides next, and forgets what it was last asked to verify. */
const verifierDecides = (ok: boolean, error?: string) => {
	Object.assign(verifierState, { ok, error, lastEvidence: undefined });
};

class StubVerifierStepper extends AStepper implements IHasCycles {
	description = "Registers a verifier whose verdict and last evidence the tests state and read.";
	cycles: IStepperCycles = {
		startFeature: () => {
			const verifier = stubVerifier({
				verify: (evidence) => {
					verifierState.lastEvidence = evidence;
					return Promise.resolve(verifierState.ok ? { ok: true } : { ok: false, error: verifierState.error ?? "bad signature" });
				},
			});
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
	it("attributes authored writes inside `holding capability` to the verified capability's controller", async () => {
		verifierDecides(true);
		const world = getDefaultWorld({ HAIBUN_LOG_LEVEL: "none" });
		world.runtime.keys = { ...world.runtime.keys, principal: resolveSitePrincipal({}) };

		const feature = {
			path: "/features/authority-signed-capability.feature",
			content: `
set cap as json to ${CAP_JSON}
holding capability cap at "urn:res:1", comment on "${TEST_NODE_LABEL}" "node-1" with "hi from the capability holder"
`,
		};

		const result = await testWithWorld(world, [feature], STEPPERS);
		if (!result.ok) {
			const steps = result.featureResults?.flatMap((fr) => fr.stepResults.map((sr) => `${sr.in}: ${sr.ok}${sr.ok ? "" : `, ${sr.errorMessage}`}`)) ?? [];
			throw new Error(`failure: ${result.failure?.error?.message ?? "none"}\n${steps.join("\n")}`);
		}
		expect(result.ok).toBe(true);

		const store = world.shared.getStore();
		const comments = await store.queryIndividuals<{ id: string; author: string }>(COMMENT_LABEL);
		expect(comments.length).toBe(1);
		expect(itemAt(comments, 0).author).toBe(SUBKEY_DID);

		const evidence = verifierState.lastEvidence;
		if (evidence?.kind !== "document") throw new Error("the verifier wasn't asked to verify a document");
		expect(evidence.action, "the verifier checks the document for everything it allows, since a single action isn't asked").toBeUndefined();
		expect(evidence.target, "and what it was asked of").toBe("urn:res:1");
		expect(evidence.document.id, "and is handed the document itself to read").toBe("urn:zcap:alice-comment");
		expect(evidence.presenter, "and who presents it, the root here, which the verifier holds to the document's controller").toEqual({ root: true });
	});

	it("fails the step (and doesn't write a record) when the registered verifier rejects the signed capability", async () => {
		verifierDecides(false, "invalid proof");
		const world = getDefaultWorld({ HAIBUN_LOG_LEVEL: "none" });
		world.runtime.keys = { ...world.runtime.keys, principal: resolveSitePrincipal({}) };

		const feature = {
			path: "/features/authority-signed-capability-fail.feature",
			content: `
set cap as json to ${CAP_JSON}
holding capability cap at "urn:res:1", comment on "${TEST_NODE_LABEL}" "node-1" with "should never be written"
`,
		};

		const result = await testWithWorld(world, [feature], STEPPERS);
		expect(result.ok).toBe(false);

		const store = world.shared.getStore();
		const comments = await store.queryIndividuals<{ id: string; author: string }>(COMMENT_LABEL);
		expect(comments.length).toBe(0);
	});
});
