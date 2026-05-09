import { describe, expect, it } from "vitest";
import { getDefaultWorld, passWithDefaults } from "../lib/test/lib.js";
import { discoverSteps } from "../lib/step-dispatch.js";

import { AStepper } from "../lib/astepper.js";
import { OK } from "../schema/protocol.js";
import { actionNotOK } from "../lib/util/index.js";
import ZcapStepper from "./zcap-stepper.js";
import { getZcapAuthority } from "../lib/zcap-authority.js";

class VerifyZcapStepper extends AStepper {
	steps = {
		verifyIssuedZcapGrant: {
			gwta: "verify zcap bearer grant for token {token: zcap-token} is active for action {action: zcap-action}",
			action: ({ token, action }: { token: string; action: string }) => {
				const granted = getZcapAuthority(this.getWorld().runtime)?.resolveBearer(token) ?? [];
				return granted.includes(action) ? OK : actionNotOK(`Expected ${token} to grant ${action}, got ${JSON.stringify(granted)}`);
			},
		},
		verifyRevokedZcapGrant: {
			gwta: "verify zcap bearer grant for token {token: zcap-token} is revoked for action {action: zcap-action}",
			action: ({ token, action }: { token: string; action: string }) => {
				const granted = getZcapAuthority(this.getWorld().runtime)?.resolveBearer(token) ?? [];
				return !granted.includes(action) ? OK : actionNotOK(`Expected ${token} to stop granting ${action}, got ${JSON.stringify(granted)}`);
			},
		},
	};
}

describe("ZcapStepper", () => {
	it("registers ZCAP domains and exposes schemas through discovery", async () => {
		const world = getDefaultWorld();
		const stepper = new ZcapStepper();
		await stepper.setWorld(world, [stepper]);
		const concerns = stepper.cycles.getConcerns?.();
		if (!concerns?.domains) throw new Error("Expected ZCAP domains to be declared");
		for (const domain of concerns.domains) {
			world.domains[domain.selectors[0]] = {
				selectors: [...domain.selectors],
				schema: domain.schema,
				coerce: domain.coerce ?? ((proto) => domain.schema.parse(proto.value)),
				comparator: domain.comparator,
				values: domain.values,
				description: domain.description,
			};
		}

		const discovery = discoverSteps([stepper], world);
		expect(discovery.domains["zcap-token"]?.description).toContain("Opaque bearer token");
		expect(discovery.domains["zcap-action"]?.description).toContain("action label");

		const issueStep = discovery.steps.find((step) => step.method === "ZcapStepper-issueZcapBearerGrant");
		expect(issueStep?.inputSchema?.required).toEqual(["token", "action"]);
		expect(issueStep?.outputSchema).toBeDefined();
	});

	it("issues and revokes ZCAP bearer grants through normal steps", async () => {
		const feature = {
			path: "/features/zcap-stepper.feature",
			content: `
issue zcap bearer grant for token "alpha" with action "Ping:protected"
verify zcap bearer grant for token "alpha" is active for action "Ping:protected"
revoke zcap bearer grant for token "alpha"
verify zcap bearer grant for token "alpha" is revoked for action "Ping:protected"
`,
		};

		const result = await passWithDefaults([feature], [ZcapStepper, VerifyZcapStepper]);
		if (!result.ok) {
			throw new Error(JSON.stringify(result.featureResults, null, 2));
		}
		expect(result.ok).toBe(true);
	});
});
