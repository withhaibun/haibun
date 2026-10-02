import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionAuthority } from "./session-authority.js";
import { readingAt, runActingAs, runAuthorizedWith, runReadingAt } from "./capability-context.js";
import { EVERY_ACTION, readAction } from "./actions.js";
import { AUTHORITY_CAPABILITIES } from "../steps/authority-stepper.js";
import { Access } from "./resources.js";
import type { IAuthorityVerifier, TActingFor, TAuthorityEvidence, TOutgoingRequest } from "./authority-types.js";

describe("SessionAuthority", () => {
	describe("evidence from outside this process", () => {
		const evidence: TAuthorityEvidence = { kind: "document", document: { id: "urn:cap:1" }, action: "read", target: "urn:res:1", presenter: { root: true } };

		it("refuses it when a verifier isn't registered to decide it, rather than deciding it here", async () => {
			const authority = new SessionAuthority();
			const result = await authority.verifyEvidence(evidence);
			expect(result.ok).toBe(false);
			expect(result.error).toBe("a verifier isn't registered to decide this evidence");
		});

		it("hands it to the registered verifier, and states who it proved was acting", async () => {
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

	describe("recording and revoking a delegation", () => {
		const AT = "2026-09-24T00:00:00.000Z";
		const UNRECORDED = "urn:cap:unrecorded";
		/** A verifier that records who each act was done for, and the level it read at. */
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

		it("acts for the root where the call holds every action, and for the key a caller proved where it holds less, reading as the instance", async () => {
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

		it("ends when a capability it rests on is revoked, stating which, and a call resting on others holds", () => {
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

		it("refuses to sign when a signer isn't registered, naming the action and where", () => {
			expect(() => new SessionAuthority().signRequest(request, "Peer:act")).toThrow(
				"a signer isn't registered, so this process can't invoke Peer:act at http://peer.example/rpc/m",
			);
		});

		it("hands the request and the action to the registered invoker", async () => {
			const authority = new SessionAuthority();
			authority.registerInvoker({ sign: (signed, action) => Promise.resolve({ ...signed.headers, "capability-invocation": `signed action="${action}"` }) });
			expect(await authority.signRequest(request, "Peer:act")).toEqual({ "content-type": "application/json", "capability-invocation": 'signed action="Peer:act"' });
		});
	});
});
