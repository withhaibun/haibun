import { describe, expect, it } from "vitest";

import { SessionAuthority } from "./session-authority.js";
import { readingAt, runReadingAt } from "./capability-context.js";
import { Access } from "./resources.js";
import type { IAuthorityVerifier, TAuthorityEvidence, TOutgoingRequest } from "./authority-types.js";

describe("SessionAuthority", () => {
	describe("evidence from outside this process", () => {
		const evidence: TAuthorityEvidence = { kind: "document", document: { id: "urn:cap:1" }, action: "read", target: "urn:res:1" };

		it("refuses it when nothing is registered to decide it, rather than deciding it here", async () => {
			const authority = new SessionAuthority();
			const result = await authority.verifyEvidence(evidence);
			expect(result.ok).toBe(false);
			expect(result.error).toBe("no verifier is registered to decide this evidence");
		});

		it("hands it to the registered verifier, and says who it proved was acting", async () => {
			const authority = new SessionAuthority();
			const stub: IAuthorityVerifier = { verify: async () => ({ ok: true, principal: "did:example:holder" }), delegationsTo: async () => ({ delegations: [] }) };
			authority.registerVerifier(stub);
			const result = await authority.verifyEvidence(evidence);
			expect(result).toEqual({ ok: true, principal: "did:example:holder" });
		});

		it("decides as the instance, reading its own records whatever the call it is part of may read", async () => {
			const authority = new SessionAuthority();
			const readAt: unknown[] = [];
			authority.registerVerifier({
				verify: async () => (readAt.push(readingAt() ?? "unbounded"), { ok: true }),
				delegationsTo: async () => (readAt.push(readingAt() ?? "unbounded"), { delegations: [] }),
			});
			await runReadingAt(Access.public, async () => {
				await authority.verifyEvidence(evidence);
				await authority.delegationsTo("did:key:zHolder");
			});
			expect(readAt, "a chain it checks and the delegations it answers a key are read from every record").toEqual(["unbounded", "unbounded"]);
		});
	});

	describe("authority this process presents elsewhere", () => {
		const request: TOutgoingRequest = { method: "POST", url: "http://peer.example/rpc/m", headers: { "content-type": "application/json" }, body: "{}" };

		it("refuses to sign when nothing is registered to, naming the action and where", () => {
			expect(() => new SessionAuthority().signRequest(request, "Peer:act")).toThrow(
				"nothing is registered to sign a request, so this process can't invoke Peer:act at http://peer.example/rpc/m",
			);
		});

		it("hands the request and the action to the registered invoker", async () => {
			const authority = new SessionAuthority();
			authority.registerInvoker({ sign: (signed, action) => Promise.resolve({ ...signed.headers, "capability-invocation": `signed action="${action}"` }) });
			expect(await authority.signRequest(request, "Peer:act")).toEqual({ "content-type": "application/json", "capability-invocation": 'signed action="Peer:act"' });
		});
	});
});
