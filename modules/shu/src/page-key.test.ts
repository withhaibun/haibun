/**
 * What a reader's page holds, and what it sends. The page keeps one key, whose private half is never readable material,
 * and holds what was delegated to it here, so what proves a request is a signature over that request under a
 * delegation to the page's key, rather than possession of anything that could be copied out of the page.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { forgetPageAuthority, openPageAuthority, pageAuthority, pageHolds, pageMay, signedHeaders } from "./page-key.js";

const SITE = "http://localhost:8123";
const delegatedAll = { id: "urn:uuid:owner", invocationTarget: SITE, allowedAction: ["*"], expires: "2099-01-01T00:00:00Z" };
const delegatedReading = { id: "urn:uuid:reader", invocationTarget: SITE, allowedAction: ["Read:private"], expires: "2099-01-01T00:00:00Z" };

/** Open the page's authority as a deployment that delegated `delegations` to its key and lets anyone hold `anyone`. */
const opened = (delegations: Record<string, unknown>[], anyone: string[] = []) => openPageAuthority(() => Promise.resolve({ delegations, recordedAs: "Capability" }), anyone);

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

	it("is what the page asks the deployment about, and holds what it answers with what anyone holds here", async () => {
		let askedFor: string | undefined;
		const authority = await openPageAuthority((controller) => {
			askedFor = controller;
			return Promise.resolve({ delegations: [delegatedReading], recordedAs: "Capability" });
		}, ["Read:public"]);
		expect(askedFor, "its own key, and nothing it chose").toBe(authority.controller);
		expect(pageHolds()).toEqual(["Read:public", "Read:private"]);
		expect(pageMay("Read:opened"), "a private read allows a narrower one").toBe(true);
		expect(pageMay("ResourcesStepper:comment"), "and nothing it wasn't given").toBe(false);
		expect(pageAuthority()?.recordedAs, "and where each delegation is recorded").toBe("Capability");
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
		expect(headers?.authorization, "and the signature names the page's key").toContain(controller);
		expect(headers?.digest, "which covers the body as well, so what was asked cannot be swapped").toBeTruthy();
	});

	it("signs a request with no body without a digest, as the page asks for the run's stream", async () => {
		await opened([delegatedReading]);
		const headers = await signedHeaders(call("Read:private", "GET"));
		expect(headers?.["capability-invocation"]).toContain('action="Read:private"');
		expect(headers?.digest).toBeUndefined();
	});

	it("signs nothing where no delegation allows the call, which is sent as it is for what anyone holds to decide", async () => {
		await opened([delegatedReading], ["ResourcesStepper:comment"]);
		expect(await signedHeaders(call("ResourcesStepper:comment"))).toBeUndefined();
		expect(await signedHeaders({ ...call("Read:private"), url: "http://elsewhere.example/rpc/x" }), "nor a call to another instance").toBeUndefined();
	});

	it("signs nothing before the page has read what it holds", async () => {
		expect(await signedHeaders(call("ShuStepper:showViews"))).toBeUndefined();
	});
});
