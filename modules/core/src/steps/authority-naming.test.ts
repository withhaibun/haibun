import { describe, expect, it } from "vitest";
import { getDefaultWorld, testWithWorld } from "../lib/test/lib.js";
import { LogicStepper } from "../lib/test/logic-stepper.js";
import { PRINCIPAL_LABEL } from "../lib/domains/resources.js";
import { recordOf } from "../lib/records/pipelines/record-reads.js";
import AuthorityStepper from "./authority-stepper.js";
import ResourcesStepper from "./resources-stepper.js";

describe("AuthorityStepper site naming (federation bootstrap)", () => {
	it("assigns did:site:<mine>.<n> to each connecting site, durably counting from persisted Principals so n never repeats", async () => {
		const world = getDefaultWorld({ HAIBUN_LOG_LEVEL: "none" });
		const feature = {
			path: "/features/authority-naming.feature",
			content: `
name a connecting site
name a connecting site
`,
		};

		const result = await testWithWorld(world, [feature], [AuthorityStepper, ResourcesStepper, LogicStepper]);
		if (!result.ok) throw new Error(JSON.stringify(result.featureResults, null, 2));

		const store = world.shared.getStore();
		// The namer's own root Principal plus one Principal per assigned name, each self-controlled (naming is not capability delegation).
		const first = await recordOf(store, PRINCIPAL_LABEL, "did:site:0.1");
		const second = await recordOf(store, PRINCIPAL_LABEL, "did:site:0.2");
		expect(first?.controller).toBe("did:site:0.1");
		expect(second?.controller).toBe("did:site:0.2");
		expect((await recordOf(store, PRINCIPAL_LABEL, "did:site:0"))?.id).toBe("did:site:0");
	});
});
