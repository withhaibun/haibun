/**
 * What a reader's page holds, and what it sends. The private half of its key is never readable material and never
 * leaves the browser's key store, so what proves a request is a signature over that request rather than possession of
 * anything that could be copied out of the page.
 */
import { describe, it, expect, afterEach } from "vitest";
import { openSession, session, closeSession, signedHeaders } from "./session-key.js";

const ISSUED = {
	keyId: "did:key:zHolder#zHolder",
	credential: { id: "urn:uuid:session-1", allowedAction: ["comment.grant"] },
	allowedAction: ["comment.grant"],
	expires: "2099-01-01T00:00:00Z",
};

const opened = (onPresented?: (key: JsonWebKey) => void) =>
	openSession((holderKey) => {
		onPresented?.(holderKey);
		return Promise.resolve(ISSUED);
	});

afterEach(() => closeSession());

describe("the key a page controls", () => {
	it("presents only its public half, and never anything that could be signed with", async () => {
		let presented: JsonWebKey | undefined;
		await opened((key) => {
			presented = key;
		});
		expect(presented?.kty, "an elliptic-curve public key").toBe("EC");
		expect(presented?.crv).toBe("P-256");
		expect(presented?.x, "with the coordinates that make it checkable").toBeTruthy();
		expect(presented?.d, "and no private half: that is what non-extractable means").toBeUndefined();
	});

	it("makes its own key, so two pages of one app are two readers", async () => {
		let first: JsonWebKey | undefined;
		let second: JsonWebKey | undefined;
		await opened((key) => {
			first = key;
		});
		closeSession();
		await opened((key) => {
			second = key;
		});
		expect(second?.x).not.toBe(first?.x);
	});

	it("holds what it was given, for a view that shows a reader what they may do", async () => {
		await opened();
		expect(session()?.allowedAction).toEqual(["comment.grant"]);
		expect(session()?.expires).toBe(ISSUED.expires);
		expect(session()?.keyId, "and what its signatures are made as").toBe(ISSUED.keyId);
	});
});

describe("what a page sends", () => {
	it("signs the request it is making, naming the action and the key that proved it", async () => {
		await opened();
		const headers = await signedHeaders({
			url: "http://localhost:8123/rpc/ShuStepper-showViews",
			method: "POST",
			headers: { host: "localhost:8123", "content-type": "application/json" },
			json: { jsonrpc: "2.0", id: "1", method: "ShuStepper-showViews", params: {} },
			action: "comment.grant",
		});
		expect(headers?.["capability-invocation"], "the presentation names the action it exercises").toContain('action="comment.grant"');
		expect(headers?.authorization, "and the signature names the key that made it").toContain(ISSUED.keyId);
		expect(headers?.digest, "which covers the body as well, so what was asked cannot be swapped").toBeTruthy();
	});

	it("holds nothing where the deployment gives a reader nothing, and keeps no key it cannot use", async () => {
		const opened = await openSession(() => Promise.resolve({ allowedAction: [] }));
		expect(opened, "a deployment that requires no authority of a reader has answered").toBeUndefined();
		expect(session()).toBeUndefined();
	});

	it("signs nothing when the reader holds nothing, since there is nothing to prove", async () => {
		const headers = await signedHeaders({ url: "http://localhost:8123/rpc/x", method: "POST", headers: {}, json: {}, action: "comment.grant" });
		expect(headers).toBeUndefined();
	});
});
