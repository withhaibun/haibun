import { grantHandle, shownGrant } from "./authority-stepper.js";
import { describe, expect, it } from "vitest";
import { getDefaultWorld, passWithDefaults } from "../lib/test/lib.js";
import { discoverSteps } from "../lib/step-registry.js";

import { AStepper } from "../lib/astepper.js";
import { OK } from "../schema/protocol.js";
import { actionNotOK } from "../lib/util/index.js";
import AuthorityStepper from "./authority-stepper.js";
import { getAuthority } from "../lib/session-authority.js";

class VerifySessionStepper extends AStepper {
	steps = {
		verifyIssuedSessionGrant: {
			gwta: "verify session grant for token {token: session-token} is active for action {action: authority-action}",
			action: ({ token, action }: { token: string; action: string }) => {
				const granted = getAuthority(this.getWorld().runtime)?.resolveSession(token) ?? [];
				return granted.includes(action) ? OK : actionNotOK(`Expected ${token} to grant ${action}, got ${JSON.stringify(granted)}`);
			},
		},
		verifyRevokedSessionGrant: {
			gwta: "verify session grant for token {token: session-token} is revoked for action {action: authority-action}",
			action: ({ token, action }: { token: string; action: string }) => {
				const granted = getAuthority(this.getWorld().runtime)?.resolveSession(token) ?? [];
				return !granted.includes(action) ? OK : actionNotOK(`Expected ${token} to stop granting ${action}, got ${JSON.stringify(granted)}`);
			},
		},
	};
}

describe("AuthorityStepper", () => {
	it("registers its domains and exposes schemas through discovery", async () => {
		const world = getDefaultWorld();
		const stepper = new AuthorityStepper();
		await stepper.setWorld(world, [stepper]);
		const concerns = stepper.cycles.getConcerns?.();
		if (!concerns?.domains) throw new Error("Expected the authority domains to be declared");
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
		expect(discovery.domains["session-token"]?.description).toContain("token an in-process session presents");
		expect(discovery.domains["authority-action"]?.description).toContain("action label");

		const issueStep = discovery.steps.find((step) => step.method === "AuthorityStepper-issueSessionGrant");
		expect(issueStep?.inputSchema?.required).toEqual(["token", "action"]);
		expect(issueStep?.outputSchema).toBeDefined();
	});

	it("issues and revokes session grants through normal steps", async () => {
		const feature = {
			path: "/features/authority-stepper.feature",
			content: `
issue session grant for token "alpha" with action "Ping:protected"
verify session grant for token "alpha" is active for action "Ping:protected"
revoke session grant for token "alpha"
verify session grant for token "alpha" is revoked for action "Ping:protected"
`,
		};

		const result = await passWithDefaults([feature], [AuthorityStepper, VerifySessionStepper]);
		if (!result.ok) {
			throw new Error(JSON.stringify(result.featureResults, null, 2));
		}
		expect(result.ok).toBe(true);
	});
});

describe("what a listing of authority may say", () => {
	it("says who holds it and what it allows, and never the credential itself", () => {
		const shown = shownGrant({ id: "s-1", token: "s-1", controller: "did:site:0", allowedAction: ["Instance:read"], revoked: false, created: 1, note: "the served app's own session" });
		expect(shown, "everything a reader needs to see who may do what, and a name to revoke it by").toEqual({
			handle: grantHandle("s-1"),
			controller: "did:site:0",
			allowedAction: ["Instance:read"],
			revoked: false,
			created: 1,
			note: "the served app's own session",
		});
		expect(Object.keys(shown), "and nothing that would hand the credential over").not.toContain("token");
		expect(Object.keys(shown), "including the id, which is the token").not.toContain("id");
		expect(shown.handle, "the name is not the credential, and cannot be presented as one").not.toBe("s-1");
		expect(shownGrant({ id: "s-1", token: "s-1", allowedAction: [], revoked: false }).handle, "and it is the same name every time that grant is read").toBe(shown.handle);
	});
});
