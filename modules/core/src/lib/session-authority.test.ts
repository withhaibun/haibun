import { afterEach, describe, expect, it, vi } from "vitest";

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

	describe("a call held open", () => {
		afterEach(() => vi.useRealTimers());

		it("ends when a capability it rests on is revoked, saying which, and a call resting on others holds", () => {
			const authority = new SessionAuthority();
			const delegated = authority.holdWhile({ capabilities: ["urn:root", "urn:cap:extension"] });
			const other = authority.holdWhile({ capabilities: ["urn:root", "urn:cap:page"] });
			authority.revoked("urn:cap:extension");
			expect(delegated.signal.aborted).toBe(true);
			expect(delegated.signal.reason).toBe("urn:cap:extension was revoked");
			expect(other.signal.aborted, "resting on another capability").toBe(false);
			authority.revoked("urn:root");
			expect(other.signal.reason, "and on a revoked ancestor").toBe("urn:root was revoked");
		});

		it("ends when its authority expires, beyond the longest delay a timer takes", () => {
			vi.useFakeTimers({ now: Date.parse("2026-01-01T00:00:00Z") });
			const authority = new SessionAuthority();
			const expires = "2026-02-01T00:00:00.000Z";
			const held = authority.holdWhile({ capabilities: ["urn:cap:1"], expires });
			vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000);
			expect(held.signal.aborted, "a day before it expires").toBe(false);
			vi.advanceTimersByTime(24 * 60 * 60 * 1000);
			expect(held.signal.reason).toBe(`the authority it rests on expired at ${expires}`);
			expect(authority.holdWhile({ capabilities: ["urn:cap:1"], expires }).signal.aborted, "one already expired ends at once").toBe(true);
		});

		it("is no longer watched once released, and refuses an expiry that is not a time", () => {
			const authority = new SessionAuthority();
			const held = authority.holdWhile({ capabilities: ["urn:cap:1"] });
			held.release();
			authority.revoked("urn:cap:1");
			expect(held.signal.aborted).toBe(false);
			expect(() => authority.holdWhile({ capabilities: ["urn:cap:1"], expires: "soon" })).toThrow("a held call rests on authority whose expiry, soon, is not a time");
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
