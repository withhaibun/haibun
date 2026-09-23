/**
 * What a request is allowed to do here, and who it proved itself to be. The proof itself is a specification's
 * business and a consumer registers what reads it; what is checked here is what the boundary does with the answer:
 * that a failed or unverifiable proof refuses the request, that a proof says who acted, and that a request presenting
 * nothing holds what anyone holds here, which is nothing unless the deployment says otherwise.
 */
import { describe, it, expect } from "vitest";
import { grantedCapabilityForRequest } from "./capability-auth.js";
import { SessionAuthority, AUTHORITY_KEY } from "@haibun/core/lib/session-authority.js";
import { runActingAs } from "@haibun/core/lib/capability-context.js";
import { currentPrincipal } from "@haibun/core/lib/principal.js";
import type { TRuntime, TWorld } from "@haibun/core/lib/world.js";
import type { IAuthorityVerifier, TAuthorityEvidence, TDelegations } from "@haibun/core/lib/authority-types.js";

const READER = "did:key:zReader";
const ACTION = "comment.grant";

/** Stands for whatever a deployment registers: this one accepts a request naming the reader, and refuses the rest. */
class StubVerifier implements IAuthorityVerifier {
	verify(evidence: TAuthorityEvidence): Promise<{ ok: boolean; error?: string; principal?: string; allowedAction?: string[] }> {
		const accepted = evidence.kind === "request" && evidence.headers["capability-invocation"]?.includes(ACTION);
		return Promise.resolve(accepted ? { ok: true, principal: READER, allowedAction: [ACTION, "comment.deny"] } : { ok: false, error: "not this one" });
	}

	delegationsTo(): Promise<TDelegations> {
		return Promise.resolve({ delegations: [] });
	}
}

/** What anyone holds at a deployment that states nothing, and at one anyone may read. */
const NOBODY: string[] = [];
const PUBLIC_SITE = ["Read:public"];

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
		const carried = await grantedCapabilityForRequest(signedRequest(ACTION), runtimeWith(authority), NOBODY);
		expect(carried.granted, "what the delegation the request proved allows").toEqual([ACTION, "comment.deny"]);
		expect(carried.principal, "and who proved it, which is who acted").toBe(READER);
	});

	it("grants what anyone holds here beside what a proof allows", async () => {
		const authority = new SessionAuthority();
		authority.registerVerifier(new StubVerifier());
		expect((await grantedCapabilityForRequest(signedRequest(ACTION), runtimeWith(authority), PUBLIC_SITE)).granted).toEqual(["Read:public", ACTION, "comment.deny"]);
	});

	it("refuses a request whose proof fails, granting nothing and naming no one", async () => {
		const authority = new SessionAuthority();
		authority.registerVerifier(new StubVerifier());
		const carried = await grantedCapabilityForRequest(signedRequest("comment.revoke"), runtimeWith(authority), PUBLIC_SITE);
		expect(carried.refused, "the request is refused, with the verifier's reason").toBe("the presented authority failed verification: not this one");
		expect(carried.granted, "a refused proof allows nothing, not even what anyone holds").toEqual([]);
		expect(carried.principal, "and a refusal is nobody acting").toBeUndefined();
	});

	it("refuses a request presenting a proof that nothing here verifies", async () => {
		const carried = await grantedCapabilityForRequest(signedRequest(ACTION), runtimeWith(new SessionAuthority()), NOBODY);
		expect(carried.refused).toBe("the request presents authority, and nothing here verifies it");
	});

	it("holds what anyone holds and names no one for a request presenting nothing, whatever else it carries", async () => {
		const authority = new SessionAuthority();
		authority.registerVerifier(new StubVerifier());
		const presentingNothing = { method: "POST", url: "http://site.test:8123/rpc/x", headers: { authorization: "Bearer tkn" } };
		expect(await grantedCapabilityForRequest(presentingNothing, runtimeWith(authority), NOBODY), "a secret it carries is no authority").toEqual({ granted: [] });
		expect(await grantedCapabilityForRequest(presentingNothing, runtimeWith(authority), PUBLIC_SITE), "and anyone may read a public site").toEqual({ granted: PUBLIC_SITE });
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
