import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getDefaultWorld, testWithWorld } from "../lib/test/lib.js";
import { resolveSitePrincipal } from "../lib/host-id.js";
import { AStepper, type IHasCycles, type IStepperCycles } from "../lib/astepper.js";
import { COMMENT_LABEL, LinkRelations, type TDomainDefinition } from "../lib/resources.js";
import AuthorityStepper from "./authority-stepper.js";
import ResourcesStepper from "./resources-stepper.js";

const TEST_NODE_LABEL = "TestNode";
const testNodeDomain: TDomainDefinition = {
	selectors: ["test-node"],
	schema: z.object({ id: z.string() }),
	description: "Minimal persisted type for subkey attribution tests",
	topology: { persistedAs: TEST_NODE_LABEL, id: "id", properties: { id: LinkRelations.IDENTIFIER.rel } },
};

class TestNodeStepper extends AStepper implements IHasCycles {
	cycles: IStepperCycles = { getConcerns: () => ({ domains: [testNodeDomain] }) };
	steps = {};
}

describe("AuthorityStepper subkey attribution", () => {
	it("attributes authored writes inside `as subkey` to the subkey DID derived from the site principal", async () => {
		const world = getDefaultWorld({ HAIBUN_LOG_LEVEL: "none" });
		const sitePrincipal = resolveSitePrincipal({});
		expect(sitePrincipal).toBe("did:site:0");
		world.runtime.keys = { ...world.runtime.keys, principal: sitePrincipal };

		const feature = {
			path: "/features/authority-subkey.feature",
			content: `
issue subkey "alice" delegated from site key with action "ResourcesStepper:comment"
as subkey "alice", comment on "${TEST_NODE_LABEL}" node-1 with "hi from alice"
`,
		};

		const result = await testWithWorld(world, [feature], [AuthorityStepper, ResourcesStepper, TestNodeStepper]);
		if (!result.ok) {
			throw new Error(JSON.stringify(result.featureResults, null, 2));
		}
		expect(result.ok).toBe(true);

		const store = world.shared.getStore();
		const comments = await store.queryIndividuals<{ id: string; author: string }>(COMMENT_LABEL);
		expect(comments.length).toBe(1);
		expect(comments[0].author).toBe("did:site:0:alice");
	});
});
