/**
 * Tests the signed-capability step of AuthorityStepper: `holding capability {cap} at {target}, {what}`. A signed
 * capability proves the principal, and a registered IAuthorityVerifier verifies the capability. The verifier in these
 * tests is a test double. haibun-core doesn't implement cryptography, and the consumer implements the ZCAP-LD verifier.
 * The stub verifier doesn't return a principal, so the statement runs as the capability's controller, and authored writes
 * name the controller as author.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getDefaultWorld, testWithWorld } from "../lib/test/lib.js";
import { resolveSitePrincipal } from "../lib/domains/host-id.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "../lib/steps/domains/stepper.js";
import { Access, COMMENT_LABEL, LinkRelations, type TDomainDefinition } from "../lib/domains/resources.js";
import { getAuthority } from "../lib/session-authority.js";
import { readAction } from "../lib/domains/actions.js";
import type { TAuthorityEvidence } from "../lib/domains/authority-types.js";
import { stubVerifier } from "../lib/test/fake-authority.js";
import { itemAt } from "../lib/domains/item-at.js";
import { readEvery } from "../lib/records/pipelines/record-reads.js";
import AuthorityStepper from "./authority-stepper.js";
import ResourcesStepper from "./resources-stepper.js";
import VariablesStepper from "./variables-stepper.js";

const TEST_NODE_LABEL = "TestNode";
const testNodeDomain: TDomainDefinition = {
	selectors: ["test-node"],
	schema: z.object({ id: z.string() }),
	description: "Minimal persisted type for signed-capability attribution tests",
	topology: { persistedAs: TEST_NODE_LABEL, accessLevel: Access.private, id: "id", properties: { id: LinkRelations.IDENTIFIER.rel } },
};

class TestNodeStepper extends AStepper implements IHasCycles {
	description = "Declares a minimal persisted type for attribution tests.";
	cycles: IStepperCycles = { getConcerns: () => ({ domains: [testNodeDomain] }) };
	steps = {};
}

/** Holds the evidence the registered verifier last received, and the result it returns. StubVerifierStepper registers
 *  the verifier after AuthorityStepper installs the authority. */
const verifierState: { lastEvidence?: TAuthorityEvidence; ok: boolean; error?: string } = { ok: true };
/** Sets the result the verifier returns next, and clears the evidence it last received. */
const verifierDecides = (ok: boolean, error?: string) => {
	Object.assign(verifierState, { ok, error, lastEvidence: undefined });
};

class StubVerifierStepper extends AStepper implements IHasCycles {
	description = "Registers a verifier that returns the result a test sets. The verifier writes the evidence it receives to verifierState.";
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
	allowedAction: ["ResourcesStepper:comment", readAction(Access.public)],
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
		const comments = await readEvery(store, { label: COMMENT_LABEL });
		expect(comments.length).toBe(1);
		expect(itemAt(comments, 0).author).toBe(SUBKEY_DID);

		const evidence = verifierState.lastEvidence;
		if (evidence?.kind !== "document") throw new Error("the verifier didn't receive a document to verify");
		expect(evidence.action, "the evidence doesn't name an action, so the verifier checks the document for every action the document allows").toBeUndefined();
		expect(evidence.target, "the evidence names the invocation target").toBe("urn:res:1");
		expect(evidence.document.id, "the evidence holds the parsed document").toBe("urn:zcap:alice-comment");
		expect(evidence.presenter, "the evidence names the root as the presenter, and a verifier checks the presenter against the document's controller").toEqual({ root: true });
	});

	it("fails the step and doesn't write a record when the registered verifier rejects the signed capability", async () => {
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
		const comments = await readEvery(store, { label: COMMENT_LABEL });
		expect(comments.length).toBe(0);
	});
});
