/**
 * What a request is allowed to do here, and who it proved itself to be. The proof itself is a specification's
 * business and a consumer registers what reads it; what is checked here is what the boundary does with the verdict:
 * that a failed or unverifiable proof refuses the request, that a proof states who acted, and that a request not presenting
 * authority holds what the deployment allows without a delegation, which is empty unless it states otherwise.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { grantedCapabilityForRequest, requiring } from "./capability-verifier.js";
import { DELEGATIONS_READ_ACTION } from "@haibun/core/lib/domains/authority-types.js";
import { REFUSED_INVOCATION, RELOAD } from "@haibun/core/lib/rpc-wire.js";
import { SessionAuthority } from "@haibun/core/lib/pipelines/session-authority.js";
import { AUTHORITY_KEY } from "@haibun/core/lib/domains/session-authority.js";
import { runActingAs } from "@haibun/core/lib/domains/capability-context.js";
import { currentPrincipal } from "@haibun/core/lib/pipelines/principal.js";
import type { TRuntime, TWorld } from "@haibun/core/lib/world.js";
import type { IAuthorityVerifier, TAuthorityAct, TAuthorityEvidence, TDelegations, TVerdict } from "@haibun/core/lib/domains/authority-types.js";
import { actualityClock } from "@haibun/core/lib/actuality/root.js";

const READER = "did:key:zReader";
const ACTION = "comment.grant";

/** Stands for whatever a deployment registers: this one accepts a request naming the reader, and refuses the rest. */
class StubVerifier implements IAuthorityVerifier {
	verify(evidence: TAuthorityEvidence): Promise<TVerdict> {
		const invoked = evidence.kind === "request" ? evidence.headers["capability-invocation"] : undefined;
		// A key invoking its own root holds the read of its own delegations, without a delegated action.
		if (invoked?.includes(DELEGATIONS_READ_ACTION))
			return Promise.resolve({ ok: true, principal: READER, allowedAction: [DELEGATIONS_READ_ACTION], invoked: DELEGATIONS_READ_ACTION });
		return Promise.resolve(
			invoked?.includes(ACTION) ? { ok: true, principal: READER, allowedAction: [ACTION, "comment.deny"], invoked: ACTION } : { ok: false, error: "not this one" },
		);
	}

	delegationsTo(): Promise<TDelegations> {
		return Promise.resolve({ delegations: [] });
	}

	record(): Promise<TAuthorityAct> {
		return Promise.resolve({ ok: false, error: "the stub verifier doesn't record a delegation" });
	}

	revoke(): Promise<TAuthorityAct> {
		return Promise.resolve({ ok: false, error: "the stub verifier doesn't revoke a delegation" });
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
	url: "http://site.test:8123/rpc/ApprovalStepper-grant",
	headers: { "capability-invocation": `zcap capability="urn:uuid:x",action="${action}"` },
});

describe("what a request carries to a boundary", () => {
	it("grants the action a proof invokes, holds what its chain allows, and states who proved it, so what is done under it can name them", async () => {
		const authority = new SessionAuthority(actualityClock());
		authority.registerVerifier(new StubVerifier());
		const carried = await grantedCapabilityForRequest(signedRequest(ACTION), runtimeWith(authority), NOBODY);
		expect(carried.granted, "the action the request invoked, and not another its delegation allows").toEqual([ACTION]);
		expect(carried.held, "what the delegation the request proved allows, which bounds the call").toEqual([ACTION, "comment.deny"]);
		expect(carried.principal, "and who proved it, which is who acted").toBe(READER);
	});

	it("grants what the deployment allows without a delegation beside what a proof invokes", async () => {
		const authority = new SessionAuthority(actualityClock());
		authority.registerVerifier(new StubVerifier());
		expect((await grantedCapabilityForRequest(signedRequest(ACTION), runtimeWith(authority), PUBLIC_SITE)).granted).toEqual([READ_PUBLIC, ACTION]);
	});

	it("refuses a request whose proof fails, without granting an action or naming a principal", async () => {
		const authority = new SessionAuthority(actualityClock());
		authority.registerVerifier(new StubVerifier());
		const carried = await grantedCapabilityForRequest(signedRequest("comment.revoke"), runtimeWith(authority), PUBLIC_SITE);
		expect(carried.refused, "the request is refused, with the verifier's reason").toBe("the presented authority failed verification: not this one");
		expect(carried.granted, "a refused proof doesn't allow an action, even one that doesn't need a delegation").toEqual([]);
		expect(carried.principal, "and a refusal doesn't name an acting principal").toBeUndefined();
	});

	it("refuses a request presenting a proof that the runtime can't verify", async () => {
		const carried = await grantedCapabilityForRequest(signedRequest(ACTION), runtimeWith(new SessionAuthority(actualityClock())), NOBODY);
		expect(carried.refused).toBe("the request presents authority, and a verifier isn't registered to check it");
	});

	it("holds what doesn't need a delegation and doesn't name a principal for a request that doesn't present authority, whatever else it carries", async () => {
		const authority = new SessionAuthority(actualityClock());
		authority.registerVerifier(new StubVerifier());
		const presentingNothing = { method: "POST", url: "http://site.test:8123/rpc/x", headers: { authorization: "Bearer tkn" } };
		expect(await grantedCapabilityForRequest(presentingNothing, runtimeWith(authority), NOBODY), "a secret it carries isn't authority").toEqual({ granted: [], held: [] });
		expect(await grantedCapabilityForRequest(presentingNothing, runtimeWith(authority), PUBLIC_SITE), "and anyone may read a public site").toEqual({
			granted: [READ_PUBLIC],
			held: [READ_PUBLIC],
		});
	});

	it("doesn't hold what a caller holds without a delegation for a page of another site sending through a reader's browser, where a proof still does", async () => {
		const authority = new SessionAuthority(actualityClock());
		authority.registerVerifier(new StubVerifier());
		const fromAnotherSite = { host: "site.test:8123", origin: "https://elsewhere.example" };
		const unproven = { method: "POST", url: "http://site.test:8123/rpc/x", headers: fromAnotherSite };
		expect(await grantedCapabilityForRequest(unproven, runtimeWith(authority), PUBLIC_SITE), "another site's page isn't the caller").toEqual({ granted: [], held: [] });
		const ofThisSite = { ...unproven, headers: { host: "site.test:8123", origin: "http://site.test:8123" } };
		expect((await grantedCapabilityForRequest(ofThisSite, runtimeWith(authority), PUBLIC_SITE)).granted, "a page of this site is").toEqual([READ_PUBLIC]);
		const proven = { ...signedRequest(ACTION), headers: { ...signedRequest(ACTION).headers, ...fromAnotherSite } };
		expect((await grantedCapabilityForRequest(proven, runtimeWith(authority), PUBLIC_SITE)).granted, "a page can't sign, so a proof is its caller's").toContain(READ_PUBLIC);
	});
});

describe("a route that requires an action", () => {
	/** A route serving only a request that allows the action, at a deployment allowing `allowed` without a delegation. */
	const held = (allowed: string[]) => {
		const authority = new SessionAuthority(actualityClock());
		authority.registerVerifier(new StubVerifier());
		const app = new Hono();
		app.get("/held/*", requiring(ACTION, runtimeWith(authority), serving(allowed)), (c) => c.text("held"));
		return (headers: Record<string, string> = {}) => app.request("http://site.test:8123/held/one", { headers });
	};

	it("serves a request whose proof allows the action, or a request that doesn't present authority where the deployment allows it", async () => {
		expect(await (await held([])(signedRequest(ACTION).headers)).text()).toBe("held");
		expect((await held([ACTION])()).status).toBe(200);
	});

	it("refuses a request that doesn't present authority, and one whose proof fails, 403, naming why, so a browser keeps its sign-in", async () => {
		const unproven = await held([])();
		expect(unproven.status).toBe(403);
		expect(await unproven.json()).toEqual({ error: "/held/one: not a call this caller may make" });
		const ownKeyOnly = await held([])(signedRequest(DELEGATIONS_READ_ACTION).headers);
		expect(await ownKeyOnly.json(), "a key without a delegated action receives the refusal of a caller without a proof").toEqual({
			error: "/held/one: not a call this caller may make",
		});
		const failed = await held([])(signedRequest("comment.revoke").headers);
		expect(failed.status).toBe(REFUSED_INVOCATION);
		expect(await failed.json()).toEqual({ error: "/held/one: the presented authority failed verification: not this one", remedy: RELOAD.authority });
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
