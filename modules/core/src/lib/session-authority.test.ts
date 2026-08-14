import { describe, expect, it } from "vitest";

import { SessionAuthority } from "./session-authority.js";
import type { IAuthorityVerifier, TAuthorityEvidence } from "./authority-types.js";

describe("SessionAuthority", () => {
	it("issues and resolves bearer grants", () => {
		const authority = new SessionAuthority();
		authority.issueSessionGrant({ token: "alpha", allowedAction: ["Ping:protected"] });
		expect(authority.resolveSession("alpha")).toEqual(["Ping:protected"]);
	});

	it("merges multiple actions on the same token+controller", () => {
		const authority = new SessionAuthority();
		authority.issueSessionGrant({ token: "alpha", allowedAction: ["Ping:protected"], controller: "Issuer.feature" });
		authority.issueSessionGrant({ token: "alpha", allowedAction: ["Other:*"], controller: "Issuer.feature" });
		expect(authority.resolveSession("alpha").sort()).toEqual(["Other:*", "Ping:protected"]);
	});

	it("supports multiple grants on one token from different controllers", () => {
		const authority = new SessionAuthority();
		authority.issueSessionGrant({ token: "alpha", allowedAction: ["Ping:protected"], controller: "A" });
		authority.issueSessionGrant({ token: "alpha", allowedAction: ["Other:*"], controller: "B" });
		expect(authority.resolveSession("alpha").sort()).toEqual(["Other:*", "Ping:protected"]);
		expect(authority.listSessionGrants()).toHaveLength(2);
	});

	it("revokes bearer grants without deleting history", () => {
		const authority = new SessionAuthority();
		authority.issueSessionGrant({ token: "alpha", allowedAction: ["Ping:protected"] });
		expect(authority.revokeSessionGrant("alpha")).toBe(1);
		expect(authority.resolveSession("alpha")).toEqual([]);
		expect(authority.listSessionGrants()[0]).toMatchObject({
			token: "alpha",
			allowedAction: ["Ping:protected"],
			revoked: true,
		});
	});

	it("revokes a single action on a multi-action grant without revoking the whole grant", () => {
		const authority = new SessionAuthority();
		authority.issueSessionGrant({ token: "alpha", allowedAction: ["Ping:protected", "Other:*"] });
		authority.revokeSessionGrant("alpha", "Ping:protected");
		expect(authority.resolveSession("alpha")).toEqual(["Other:*"]);
	});

	describe("evidence from outside this process", () => {
		const evidence: TAuthorityEvidence = { document: { id: "urn:cap:1" }, action: "read", target: "urn:res:1" };

		it("refuses it when nothing is registered to decide it, rather than deciding it here", async () => {
			const authority = new SessionAuthority();
			const result = await authority.verifyEvidence(evidence);
			expect(result.ok).toBe(false);
			expect(result.error).toBe("no verifier is registered to decide this evidence");
		});

		it("hands it to the registered verifier, and says who it proved was acting", async () => {
			const authority = new SessionAuthority();
			const stub: IAuthorityVerifier = { verify: async () => ({ ok: true, principal: "did:example:holder" }) };
			authority.registerVerifier(stub);
			const result = await authority.verifyEvidence(evidence);
			expect(result).toEqual({ ok: true, principal: "did:example:holder" });
		});
	});

	it("allows nothing once a grant has expired, which is how authority is bounded to a session", () => {
		const authority = new SessionAuthority();
		const expires = 1_000;
		authority.issueSessionGrant({ token: "session", allowedAction: ["Instance:run"], controller: "did:site:0.1", expires });
		expect(authority.resolveSession("session", expires - 1)).toEqual(["Instance:run"]);
		expect(authority.resolveSession("session", expires)).toEqual([]);
		expect(authority.resolveSession("session", expires + 1)).toEqual([]);
	});
});
