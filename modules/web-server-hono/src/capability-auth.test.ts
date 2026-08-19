/**
 * What a request is allowed to do here, and who it proved itself to be. The proof itself is a specification's
 * business and a consumer registers what reads it; what is checked here is what the boundary does with the answer:
 * that a refusal grants nothing, that a proof says who acted, and that a token names no one.
 */
import { describe, it, expect } from "vitest";
import { grantedCapabilityForRequest } from "./capability-auth.js";
import { SessionAuthority, AUTHORITY_KEY } from "@haibun/core/lib/session-authority.js";
import { runActingAs } from "@haibun/core/lib/capability-context.js";
import { currentPrincipal } from "@haibun/core/lib/principal.js";
import type { TRuntime, TWorld } from "@haibun/core/lib/world.js";
import type { IAuthorityVerifier, TAuthorityEvidence } from "@haibun/core/lib/authority-types.js";

const READER = "did:key:zReader";
const ACTION = "comment.grant";

/** Stands for whatever a deployment registers: this one accepts a request naming the reader, and refuses the rest. */
class StubVerifier implements IAuthorityVerifier {
	verify(evidence: TAuthorityEvidence): Promise<{ ok: boolean; error?: string; principal?: string; allowedAction?: string[] }> {
		const accepted = evidence.kind === "request" && evidence.headers["capability-invocation"]?.includes(ACTION);
		return Promise.resolve(accepted ? { ok: true, principal: READER, allowedAction: [ACTION] } : { ok: false, error: "not this one" });
	}
}

const runtimeWith = (authority: SessionAuthority): TRuntime => ({ keys: { [AUTHORITY_KEY]: authority } }) as unknown as TRuntime;

const signedRequest = (action: string) => ({
	method: "POST",
	url: "http://site.test:8123/rpc/AutonomicStepper-grantPetition",
	headers: { "capability-invocation": `zcap capability="urn:uuid:x",action="${action}"` },
});

describe("what a request carries to a boundary", () => {
	it("grants what a proof allows, and says who proved it, so what is done under it can name them", async () => {
		const authority = new SessionAuthority();
		authority.registerVerifier(new StubVerifier());
		const carried = await grantedCapabilityForRequest(signedRequest(ACTION), runtimeWith(authority), {});
		expect(carried.granted, "exactly what the request proved it may do").toEqual([ACTION]);
		expect(carried.principal, "and who proved it, which is who acted").toBe(READER);
	});

	it("grants nothing and names no one when the proof is refused", async () => {
		const authority = new SessionAuthority();
		authority.registerVerifier(new StubVerifier());
		const carried = await grantedCapabilityForRequest(signedRequest("comment.revoke"), runtimeWith(authority), {});
		expect(carried.granted, "a refused proof allows nothing").toBeUndefined();
		expect(carried.principal, "and a refusal is nobody acting").toBeUndefined();
	});

	it("names no one for a token, since holding a token is not being anyone", async () => {
		const authority = new SessionAuthority();
		authority.issueSessionGrant({ token: "tkn", allowedAction: [ACTION] });
		const carried = await grantedCapabilityForRequest({ method: "POST", url: "http://site.test:8123/rpc/x", headers: { authorization: "Bearer tkn" } }, runtimeWith(authority), {});
		expect(carried.granted, "what the token was issued for").toEqual([ACTION]);
		expect(carried.principal, "but a token says nothing about who presents it").toBeUndefined();
	});
});

describe("who is acting", () => {
	const world = { runtime: { keys: {} } } as unknown as TWorld;

	it("is whoever proved themselves at the boundary this call came through", async () => {
		await runActingAs(READER, () => {
			expect(currentPrincipal(world)).toBe(READER);
			return Promise.resolve();
		});
	});

	it("is whoever the run acts as where nothing proved anything, and does not outlast the call that proved it", async () => {
		const ownWorld = { runtime: { keys: { principal: "did:site:0" } } } as unknown as TWorld;
		await runActingAs(READER, () => {
			expect(currentPrincipal(ownWorld), "a proof about this call speaks for it").toBe(READER);
			return Promise.resolve();
		});
		expect(currentPrincipal(ownWorld), "and the run is itself again once the call is over").toBe("did:site:0");
	});
});
