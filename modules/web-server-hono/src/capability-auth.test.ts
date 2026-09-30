/**
 * What a request is allowed to do here, and who it proved itself to be. The proof itself is a specification's
 * business and a consumer registers what reads it; what is checked here is what the boundary does with the answer:
 * that a failed or unverifiable proof refuses the request, that a proof states who acted, and that a request not presenting
 * authority holds what the deployment allows without a delegation, which is empty unless it states otherwise.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { grantedCapabilityForRequest, requiring } from "./capability-auth.js";
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

/** What a deployment allows without a delegation when it doesn't state an action, and when anyone may read it. */
const READ_PUBLIC = "Read:public";
const serving = (allowedWithoutDelegation: string[]) => ({ allowedWithoutDelegation });
const NOBODY = serving([]);
const PUBLIC_SITE = serving([READ_PUBLIC]);

const runtimeWith = (authority: SessionAuthority): TRuntime => ({ keys: { [AUTHORITY_KEY]: authority } }) as unknown as TRuntime;

const signedRequest = (action: string) => ({
	method: "POST",
	url: "http://site.test:8123/rpc/AutonomicStepper-grantPetition",
	headers: { "capability-invocation": `zcap capability="urn:uuid:x",action="${action}"` },
});

describe("what a request carries to a boundary", () => {
	it("grants what a proof allows, and states who proved it, so what is done under it can name them", async () => {
		const authority = new SessionAuthority();
		authority.registerVerifier(new StubVerifier());
		const carried = await grantedCapabilityForRequest(signedRequest(ACTION), runtimeWith(authority), NOBODY);
		expect(carried.granted, "what the delegation the request proved allows").toEqual([ACTION, "comment.deny"]);
		expect(carried.principal, "and who proved it, which is who acted").toBe(READER);
	});

	it("grants what the deployment allows without a delegation beside what a proof allows", async () => {
		const authority = new SessionAuthority();
		authority.registerVerifier(new StubVerifier());
		expect((await grantedCapabilityForRequest(signedRequest(ACTION), runtimeWith(authority), PUBLIC_SITE)).granted).toEqual([READ_PUBLIC, ACTION, "comment.deny"]);
	});

	it("refuses a request whose proof fails, without granting an action or naming a principal", async () => {
		const authority = new SessionAuthority();
		authority.registerVerifier(new StubVerifier());
		const carried = await grantedCapabilityForRequest(signedRequest("comment.revoke"), runtimeWith(authority), PUBLIC_SITE);
		expect(carried.refused, "the request is refused, with the verifier's reason").toBe("the presented authority failed verification: not this one");
		expect(carried.granted, "a refused proof doesn't allow an action, even one that doesn't need a delegation").toEqual([]);
		expect(carried.principal, "and a refusal doesn't name an acting principal").toBeUndefined();
	});

	it("refuses a request presenting a proof that the runtime can't verify", async () => {
		const carried = await grantedCapabilityForRequest(signedRequest(ACTION), runtimeWith(new SessionAuthority()), NOBODY);
		expect(carried.refused).toBe("the request presents authority, and a verifier isn't registered to check it");
	});

	it("holds what doesn't need a delegation and doesn't name a principal for a request that doesn't present authority, whatever else it carries", async () => {
		const authority = new SessionAuthority();
		authority.registerVerifier(new StubVerifier());
		const presentingNothing = { method: "POST", url: "http://site.test:8123/rpc/x", headers: { authorization: "Bearer tkn" } };
		expect(await grantedCapabilityForRequest(presentingNothing, runtimeWith(authority), NOBODY), "a secret it carries isn't authority").toEqual({ granted: [] });
		expect(await grantedCapabilityForRequest(presentingNothing, runtimeWith(authority), PUBLIC_SITE), "and anyone may read a public site").toEqual({ granted: [READ_PUBLIC] });
	});

	it("doesn't hold what a caller holds without a delegation for a page of another site sending through a reader's browser, where a proof still does", async () => {
		const authority = new SessionAuthority();
		authority.registerVerifier(new StubVerifier());
		const fromAnotherSite = { host: "site.test:8123", origin: "https://elsewhere.example" };
		const unproven = { method: "POST", url: "http://site.test:8123/rpc/x", headers: fromAnotherSite };
		expect(await grantedCapabilityForRequest(unproven, runtimeWith(authority), PUBLIC_SITE), "another site's page isn't the caller").toEqual({ granted: [] });
		const ofThisSite = { ...unproven, headers: { host: "site.test:8123", origin: "http://site.test:8123" } };
		expect((await grantedCapabilityForRequest(ofThisSite, runtimeWith(authority), PUBLIC_SITE)).granted, "a page of this site is").toEqual([READ_PUBLIC]);
		const proven = { ...signedRequest(ACTION), headers: { ...signedRequest(ACTION).headers, ...fromAnotherSite } };
		expect((await grantedCapabilityForRequest(proven, runtimeWith(authority), PUBLIC_SITE)).granted, "a page can't sign, so a proof is its caller's").toContain(READ_PUBLIC);
	});
});

describe("a route that requires an action", () => {
	/** A route answering only a request that allows the action, at a deployment allowing `allowed` without a delegation. */
	const held = (allowed: string[]) => {
		const authority = new SessionAuthority();
		authority.registerVerifier(new StubVerifier());
		const app = new Hono();
		app.get("/held/*", requiring(ACTION, runtimeWith(authority), serving(allowed)), (c) => c.text("held"));
		return (headers: Record<string, string> = {}) => app.request("http://site.test:8123/held/one", { headers });
	};

	it("answers a request whose proof allows the action, or a request that doesn't present authority where the deployment allows it", async () => {
		expect(await (await held([])(signedRequest(ACTION).headers)).text()).toBe("held");
		expect((await held([ACTION])()).status).toBe(200);
	});

	it("refuses a request that doesn't present authority 403, and one whose proof fails 401, naming why", async () => {
		const unproven = await held([])();
		expect(unproven.status).toBe(403);
		expect(await unproven.json()).toEqual({ error: "/held/one: not a call this caller may make" });
		const failed = await held([])(signedRequest("comment.revoke").headers);
		expect(failed.status).toBe(401);
		expect(await failed.json()).toEqual({ error: "/held/one: the presented authority failed verification: not this one" });
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

	it("is whoever actuality acts as where the call didn't present a proof, and does not outlast the call that proved it", async () => {
		const ownWorld = { runtime: { keys: { principal: "did:site:0" } } } as unknown as TWorld;
		await runActingAs(READER, () => {
			expect(currentPrincipal(ownWorld), "a proof about this call speaks for it").toBe(READER);
			return Promise.resolve();
		});
		expect(currentPrincipal(ownWorld), "and actuality is itself again once the call is over").toBe("did:site:0");
	});
});
