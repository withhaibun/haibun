import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getDefaultWorld, testWithWorld } from "../lib/test/lib.js";
import { resolveSitePrincipal } from "../lib/host-id.js";
import { AStepper, type IHasCycles, type IStepperCycles } from "../lib/astepper.js";
import { COMMENT_LABEL, LinkRelations, PRINCIPAL_LABEL, type TDomainDefinition, type TPrincipal } from "../lib/resources.js";
import AuthorityStepper from "./authority-stepper.js";
import ResourcesStepper from "./resources-stepper.js";

const ACTION = "ResourcesStepper:comment";

const TEST_NODE_LABEL = "TestNode";
const testNodeDomain: TDomainDefinition = {
	selectors: ["test-node"],
	schema: z.object({ id: z.string() }),
	description: "Minimal persisted type for Principal-attribution tests",
	topology: { persistedAs: TEST_NODE_LABEL, id: "id", properties: { id: LinkRelations.IDENTIFIER.rel } },
};

class TestNodeStepper extends AStepper implements IHasCycles {
	cycles: IStepperCycles = { getConcerns: () => ({ domains: [testNodeDomain] }) };
	steps = {};
}

describe("AuthorityStepper Principal persistence", () => {
	it("persists the root site Principal and the subkey delegation on `issue subkey`, and never persists ephemeral activations", async () => {
		const world = getDefaultWorld({ HAIBUN_LOG_LEVEL: "none" });
		const sitePrincipal = resolveSitePrincipal({});
		expect(sitePrincipal).toBe("did:site:0");
		world.runtime.keys = { ...world.runtime.keys, principal: sitePrincipal };

		const feature = {
			path: "/features/authority-principal.feature",
			content: `
issue subkey "alice" delegated from site key with action "${ACTION}"
as subkey "alice", comment on "${TEST_NODE_LABEL}" node-1 with "scratch comment"
`,
		};

		const result = await testWithWorld(world, [feature], [AuthorityStepper, ResourcesStepper, TestNodeStepper]);
		if (!result.ok) throw new Error(JSON.stringify(result.featureResults, null, 2));
		expect(result.ok).toBe(true);

		const store = world.shared.getStore();
		const subkeyDid = `${sitePrincipal}:alice`;

		// Root site Principal: self-issued (controller === id, no delegation).
		const root = await store.getIndividual<TPrincipal>(PRINCIPAL_LABEL, sitePrincipal);
		expect(root).toBeTruthy();
		expect(root?.id).toBe(sitePrincipal);
		expect(root?.controller).toBe(sitePrincipal);
		expect(typeof root?.generatedAtTime).toBe("string");

		// Subkey Principal: controller === id, allowedAction includes the delegated action.
		// Delegation is an edge, not a Principal property, so it never appears on the individual.
		const subkey = await store.getIndividual<TPrincipal>(PRINCIPAL_LABEL, subkeyDid);
		expect(subkey).toBeTruthy();
		expect(subkey?.id).toBe(subkeyDid);
		expect(subkey?.controller).toBe(subkeyDid);
		expect(String(subkey?.allowedAction)).toContain(ACTION);

		// Exactly two Principals persisted, `as subkey` (ephemeral activation) added none.
		const principals = await store.queryIndividuals<TPrincipal>(PRINCIPAL_LABEL);
		expect(principals.length).toBe(2);

		// Exactly one delegation edge: subkey --sec:delegator--> site principal.
		const subkeyDelegation = await store.query({ subject: subkeyDid, predicate: LinkRelations.DELEGATED_FROM.rel, namedGraph: PRINCIPAL_LABEL });
		expect(subkeyDelegation.length).toBe(1);
		expect(String(subkeyDelegation[0].object)).toBe(sitePrincipal);

		// The root has no delegatedFrom edge: it is self-issued, delegated from no one.
		const rootDelegation = await store.query({ subject: sitePrincipal, predicate: LinkRelations.DELEGATED_FROM.rel, namedGraph: PRINCIPAL_LABEL });
		expect(rootDelegation.length).toBe(0);

		// No private key persisted in any Principal payload.
		for (const p of principals) {
			const flat = JSON.stringify(p).toLowerCase();
			expect(flat).not.toContain("privatekey");
			expect(flat).not.toContain("secretkey");
		}

		// Comment authored under the subkey: author === subkey DID, resolvable as a Principal.
		const comments = await store.queryIndividuals<{ id: string; author: string }>(COMMENT_LABEL);
		expect(comments.length).toBe(1);
		expect(comments[0].author).toBe(subkeyDid);
		const authorPrincipal = await store.getIndividual<TPrincipal>(PRINCIPAL_LABEL, comments[0].author);
		expect(authorPrincipal?.id).toBe(subkeyDid);
	});

	it("does not persist a Principal for `as subkey` alone (no `issue subkey` ran)", async () => {
		const world = getDefaultWorld({ HAIBUN_LOG_LEVEL: "none" });
		const sitePrincipal = resolveSitePrincipal({});
		world.runtime.keys = { ...world.runtime.keys, principal: sitePrincipal };

		const feature = {
			path: "/features/authority-as-subkey-only.feature",
			content: `
as subkey "bob", comment on "${TEST_NODE_LABEL}" node-2 with "ephemeral"
`,
		};

		const result = await testWithWorld(world, [feature], [AuthorityStepper, ResourcesStepper, TestNodeStepper]);
		if (!result.ok) throw new Error(JSON.stringify(result.featureResults, null, 2));
		expect(result.ok).toBe(true);

		const store = world.shared.getStore();
		const principals = await store.queryIndividuals<TPrincipal>(PRINCIPAL_LABEL);
		expect(principals.length).toBe(0);
	});
});
