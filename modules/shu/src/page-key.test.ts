/**
 * What a reader's page holds, and what it sends. The page keeps one key, whose private half is never readable material,
 * and holds what was delegated to it here, so what proves a request is a signature over that request under a
 * delegation to the page's key, rather than possession of anything that could be copied out of the page.
 */
import { SIGNATURE_HEADER } from "@haibun/core/lib/signature-header.js";
import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { forgetPageAuthority, holdGiven, keyHeaders, openPageAuthority, pageAuthority, pageAuthorityReady, pageHolds, pageMay, signedHeaders } from "./page-key.js";

const SITE = "http://localhost:8123";
const delegatedAll = { id: "urn:uuid:owner", invocationTarget: SITE, allowedAction: ["*"], expires: "2099-01-01T00:00:00Z" };
const delegatedReading = { id: "urn:uuid:reader", invocationTarget: SITE, allowedAction: ["Read:private"], expires: "2099-01-01T00:00:00Z" };

/** Where the deployment records each delegation. */
const records = { [delegatedReading.id]: { persistedAs: "Capability", accessLevel: "private" as const } };

/** Open the page's authority as a deployment that delegated `delegations` to its key and allows `withoutDelegation` to anyone. */
const opened = (delegations: Record<string, unknown>[], withoutDelegation: string[] = []) => openPageAuthority(() => Promise.resolve({ delegations, records }), withoutDelegation);

const call = (action: string, method = "POST") => ({
	url: `${SITE}/rpc/ShuStepper-showViews`,
	method,
	headers: { host: "localhost:8123", ...(method === "POST" ? { "content-type": "application/json" } : {}) },
	...(method === "POST" ? { body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "ShuStepper-showViews", params: {} }) } : {}),
	action,
});

afterEach(() => forgetPageAuthority());

describe("the key a page controls", () => {
	it("is named as a did:key of a P-256 key, which is what a holder delegates to", async () => {
		const { controller } = await opened([]);
		expect(controller, "a P-256 did:key, which resolves from its own identifier").toMatch(/^did:key:zDn[1-9A-HJ-NP-Za-km-z]+$/);
	});

	it("is the same key after a reload, so a delegation to it goes on holding", async () => {
		const { controller: before } = await opened([]);
		forgetPageAuthority();
		const { controller: after } = await opened([]);
		expect(after).toBe(before);
	});

	it("proves only itself while it reads what was delegated to it, and holds what that answers with what doesn't need a delegation", async () => {
		let proof: Record<string, string> | undefined;
		const authority = await openPageAuthority(async () => {
			proof = await keyHeaders({ url: `${SITE}/rpc/AuthorityStepper-delegationsTo`, method: "POST", headers: { host: "localhost:8123" }, body: "{}" });
			return { delegations: [delegatedReading], records };
		}, ["Read:public"]);
		expect(proof?.["capability-invocation"], "an invocation of a root, which the deployment resolves as the signer's own").toContain('zcap id="urn:zcap:root:');
		expect(proof?.["capability-invocation"], "for the one action such a root allows").toContain('action="Authority:readOwnDelegations"');
		expect(proof?.[SIGNATURE_HEADER], "signed by the page's key").toContain(authority.controller);
		expect(pageHolds()).toEqual(["Read:public", "Read:private"]);
		expect(pageMay("Read:opened"), "a private read allows a narrower one").toBe(true);
		expect(pageMay("ResourcesStepper:comment"), "and doesn't allow a call it wasn't given").toBe(false);
		expect(pageAuthority()?.records, "and where each delegation is recorded").toEqual(records);
	});

	it("doesn't prove a key it hasn't opened", async () => {
		await expect(keyHeaders({ url: `${SITE}/rpc/AuthorityStepper-delegationsTo`, method: "POST", headers: {}, body: "{}" })).rejects.toThrow(
			/while it reads what was delegated to it/,
		);
	});

	it("says why where the browser withholds its key store, which is how a page served over plain http is reached", async () => {
		const held = globalThis.crypto;
		Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
		try {
			await expect(opened([])).rejects.toThrow(/secure context/);
		} finally {
			Object.defineProperty(globalThis, "crypto", { value: held, configurable: true });
		}
	});
});

describe("what a page sends", () => {
	it("signs a call under a delegation that allows it, invoking the action the delegation names", async () => {
		const { controller } = await opened([delegatedReading, delegatedAll]);
		const headers = await signedHeaders(call("ShuStepper:showViews"));
		expect(headers?.["capability-invocation"], "a delegation is matched on what it lists, so the action is its own").toContain('action="*"');
		expect(headers?.[SIGNATURE_HEADER], "and the signature names the page's key").toContain(controller);
		expect(headers?.digest, "which covers the body as well, so what was asked cannot be swapped").toBeTruthy();
	});

	it("signs a request that doesn't have a body without a digest, as the page asks for actuality's stream", async () => {
		await opened([delegatedReading]);
		const headers = await signedHeaders(call("Read:private", "GET"));
		expect(headers?.["capability-invocation"]).toContain('action="Read:private"');
		expect(headers?.digest).toBeUndefined();
	});

	it("doesn't sign where the delegations don't allow the call, which is sent as it is for what doesn't need a delegation to decide", async () => {
		await opened([delegatedReading], ["ResourcesStepper:comment"]);
		expect(await signedHeaders(call("ResourcesStepper:comment"))).toBeUndefined();
		expect(await signedHeaders({ ...call("Read:private"), url: "http://elsewhere.example/rpc/x" }), "nor a call to another instance").toBeUndefined();
	});

	it("doesn't sign a request before the page has read what it holds", async () => {
		expect(await signedHeaders(call("ShuStepper:showViews"))).toBeUndefined();
	});
});

describe("a delegation another page gives", () => {
	const given = (controller: string, id: string) => ({ ...delegatedReading, id, controller });

	it("holds a delegation to its key in place of the one given before, and signs with it", async () => {
		const { controller } = await opened([]);
		const first = given(controller, "urn:uuid:given-first");
		holdGiven(first);
		const renewed = given(controller, "urn:uuid:given-renewed");
		holdGiven(renewed, first);
		expect((await pageAuthorityReady())?.delegations, "what a later read of what the page holds answers").toEqual([renewed]);
		expect(pageMay("Read:private")).toBe(true);
		expect(await signedHeaders(call("Read:private"))).toBeDefined();
	});

	it("refuses a delegation to another key, and one given before the page read what it holds", async () => {
		expect(() => holdGiven(given("did:key:zDnOther", "urn:uuid:early")), "before the page read what it holds").toThrow("hasn't");
		await opened([]);
		expect(() => holdGiven(given("did:key:zDnOther", "urn:uuid:other"))).toThrow("did:key:zDnOther");
		expect(pageHolds()).toEqual([]);
	});
});
