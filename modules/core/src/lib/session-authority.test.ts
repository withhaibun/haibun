import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionAuthority } from "./session-authority.js";
import { readingAt, runActingAs, runAuthorizedWith, runReadingAt } from "./capability-context.js";
import { EVERY_ACTION, readAction } from "./actions.js";
import { AUTHORITY_CAPABILITIES } from "./actions.js";
import { Access } from "./resources.js";
import type { IAuthorityVerifier, TActingFor, TAuthorityEvidence, TOutgoingRequest } from "./authority-types.js";
import { stubVerifier } from "./test/fake-authority.js";

describe("SessionAuthority", () => {
	describe("evidence from outside this process", () => {
		const evidence: TAuthorityEvidence = { kind: "document", document: { id: "urn:cap:1" }, action: "read", target: "urn:res:1", presenter: { root: true } };

		it("refuses evidence when a verifier isn't registered, and doesn't verify it in this process", async () => {
			const authority = new SessionAuthority();
			const result = await authority.verifyEvidence(evidence);
			expect(result).toMatchObject({ ok: false, error: "a verifier isn't registered to verify this evidence" });
		});

		it("passes evidence to the registered verifier and returns the principal the verifier proved", async () => {
			const authority = new SessionAuthority();
			authority.registerVerifier(stubVerifier({ verify: async () => ({ ok: true, principal: "did:example:holder" }) }));
			const result = await authority.verifyEvidence(evidence);
			expect(result).toEqual({ ok: true, principal: "did:example:holder" });
		});

		it("verifies evidence and reads delegations without the read ceiling of the enclosing call", async () => {
			const authority = new SessionAuthority();
			const readAt: unknown[] = [];
			authority.registerVerifier(
				stubVerifier({
					verify: async () => (readAt.push(readingAt() ?? "unbounded"), { ok: true }),
					delegationsTo: async () => (readAt.push(readingAt() ?? "unbounded"), { delegations: [] }),
				}),
			);
			await runReadingAt(Access.public, async () => {
				await authority.verifyEvidence(evidence);
				await authority.delegationsTo("did:key:zHolder");
			});
			expect(readAt, "the verifier reads a chain and a key's delegations without a read ceiling").toEqual(["unbounded", "unbounded"]);
		});
	});

	describe("recording and revoking a delegation", () => {
		const AT = "2026-09-24T00:00:00.000Z";
		const UNRECORDED = "urn:cap:unrecorded";
		/** A verifier that records each act with its principal and its read level. */
		const recording = () => {
			const acts: Array<{ act: string; by: TActingFor; readAt: unknown }> = [];
			const verifier: IAuthorityVerifier = {
				verify: async () => ({ ok: true }),
				delegationsTo: async () => ({ delegations: [] }),
				record: async (document, by) => (acts.push({ act: `record ${document.id}`, by, readAt: readingAt() ?? "unbounded" }), { ok: true, id: String(document.id), at: AT }),
				revoke: async (id, by) => (acts.push({ act: `revoke ${id}`, by, readAt: readingAt() ?? "unbounded" }), { ok: true, id, at: AT }),
			};
			const authority = new SessionAuthority();
			authority.registerVerifier(verifier);
			return { authority, acts };
		};

		it("acts for the root where the call holds every action and for the proved key where the call holds less, and reads as the instance", async () => {
			const { authority, acts } = recording();
			await runAuthorizedWith([EVERY_ACTION], () => authority.recordDelegation({ id: "urn:cap:owner" }));
			await runAuthorizedWith([AUTHORITY_CAPABILITIES.revoke, readAction(Access.public)], () =>
				runActingAs("did:key:zLauncher", () => runReadingAt(Access.public, () => authority.revoke("urn:cap:panel"))),
			);
			expect(acts).toEqual([
				{ act: "record urn:cap:owner", by: { root: true }, readAt: "unbounded" },
				{ act: "revoke urn:cap:panel", by: { root: false, controller: "did:key:zLauncher" }, readAt: "unbounded" },
			]);
		});

		it("refuses a caller that didn't prove a key and holds less than every action, and refuses where a verifier isn't registered", async () => {
			const { authority, acts } = recording();
			expect(await runAuthorizedWith([AUTHORITY_CAPABILITIES.delegate], () => authority.recordDelegation({ id: UNRECORDED }))).toEqual({
				ok: false,
				error: "a caller that didn't prove a key and holds less than every action doesn't record or revoke a delegation",
			});
			expect(acts).toEqual([]);
			expect(await new SessionAuthority().revoke(UNRECORDED)).toEqual({ ok: false, error: "a verifier isn't registered to record or revoke a delegation" });
		});
	});

	describe("a call held open", () => {
		afterEach(() => vi.useRealTimers());

		it("ends when a capability it rests on is revoked and names that capability, and a call that rests on others stays open", () => {
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

		it("ends when its authority expires after more than the longest setTimeout delay", () => {
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

		it("doesn't end on a revocation after its release, and refuses an expiry that isn't a time", () => {
			const authority = new SessionAuthority();
			const held = authority.holdWhile({ capabilities: ["urn:cap:1"] });
			held.release();
			authority.revoked("urn:cap:1");
			expect(held.signal.aborted).toBe(false);
			expect(() => authority.holdWhile({ capabilities: ["urn:cap:1"], expires: "soon" })).toThrow("a held call rests on authority with an expiry that isn't a time: soon");
		});
	});

	describe("authority this process presents elsewhere", () => {
		const request: TOutgoingRequest = { method: "POST", url: "http://peer.example/rpc/m", headers: { "content-type": "application/json" }, body: "{}" };

		it("refuses to sign when a signer isn't registered, and names the action and the URL", () => {
			expect(() => new SessionAuthority().signRequest(request, "Peer:act")).toThrow(
				"a signer isn't registered, so this process can't invoke Peer:act at http://peer.example/rpc/m",
			);
		});

		it("passes the request and the action to the registered invoker", async () => {
			const authority = new SessionAuthority();
			authority.registerInvoker({ sign: (signed, action) => Promise.resolve({ ...signed.headers, "capability-invocation": `signed action="${action}"` }) });
			expect(await authority.signRequest(request, "Peer:act")).toEqual({ "content-type": "application/json", "capability-invocation": 'signed action="Peer:act"' });
		});
	});
});
