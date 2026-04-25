import { describe, expect, it } from "vitest";

import { ZcapAuthority } from "./zcap-authority.js";
import type { IZcapVerifier, TZcapInvocation } from "./zcap-types.js";

describe("ZcapAuthority", () => {
	it("issues and resolves bearer grants", () => {
		const authority = new ZcapAuthority();
		authority.issueBearerGrant({ token: "alpha", allowedAction: ["Ping:protected"] });
		expect(authority.resolveBearer("alpha")).toEqual(["Ping:protected"]);
	});

	it("merges multiple actions on the same token+controller", () => {
		const authority = new ZcapAuthority();
		authority.issueBearerGrant({ token: "alpha", allowedAction: ["Ping:protected"], controller: "Issuer.feature" });
		authority.issueBearerGrant({ token: "alpha", allowedAction: ["Other:*"], controller: "Issuer.feature" });
		expect(authority.resolveBearer("alpha").sort()).toEqual(["Other:*", "Ping:protected"]);
	});

	it("supports multiple grants on one token from different controllers", () => {
		const authority = new ZcapAuthority();
		authority.issueBearerGrant({ token: "alpha", allowedAction: ["Ping:protected"], controller: "A" });
		authority.issueBearerGrant({ token: "alpha", allowedAction: ["Other:*"], controller: "B" });
		expect(authority.resolveBearer("alpha").sort()).toEqual(["Other:*", "Ping:protected"]);
		expect(authority.listBearerGrants()).toHaveLength(2);
	});

	it("revokes bearer grants without deleting history", () => {
		const authority = new ZcapAuthority();
		authority.issueBearerGrant({ token: "alpha", allowedAction: ["Ping:protected"] });
		expect(authority.revokeBearerGrant("alpha")).toBe(1);
		expect(authority.resolveBearer("alpha")).toEqual([]);
		expect(authority.listBearerGrants()[0]).toMatchObject({
			token: "alpha",
			allowedAction: ["Ping:protected"],
			revoked: true,
		});
	});

	it("revokes a single action on a multi-action grant without revoking the whole grant", () => {
		const authority = new ZcapAuthority();
		authority.issueBearerGrant({ token: "alpha", allowedAction: ["Ping:protected", "Other:*"] });
		authority.revokeBearerGrant("alpha", "Ping:protected");
		expect(authority.resolveBearer("alpha")).toEqual(["Other:*"]);
	});

	describe("signed verification (delegated)", () => {
		it("returns no-verifier-registered when no verifier is registered", async () => {
			const authority = new ZcapAuthority();
			const invocation: TZcapInvocation = { capability: "urn:cap:1", capabilityAction: "read", invocationTarget: "urn:res:1" };
			const result = await authority.verifySigned(invocation, { action: "read", target: "urn:res:1" });
			expect(result.ok).toBe(false);
			expect(result.error).toBe("no verifier registered");
		});

		it("delegates to a registered verifier", async () => {
			const authority = new ZcapAuthority();
			const stub: IZcapVerifier = {
				verify: async () => ({ ok: true }),
			};
			authority.registerVerifier(stub);
			const invocation: TZcapInvocation = { capability: "urn:cap:1", capabilityAction: "read", invocationTarget: "urn:res:1" };
			const result = await authority.verifySigned(invocation, { action: "read", target: "urn:res:1" });
			expect(result.ok).toBe(true);
		});
	});
});
