/**
 * A call to a host's `/rpc`, built once for every caller: its address under the host's base, its envelope, and the
 * headers its proof makes over the request as it is sent, the request's `host` among them. A call that doesn't carry a proof is
 * sent with those headers as they are.
 */
import { describe, expect, it } from "vitest";
import {
	buildRpcCall,
	holdSignIn,
	newActualityId,
	parseRpcRequest,
	provesNothing,
	RELOAD,
	actualityRefusal,
	RefusedCall,
	refusalCarried,
	authorityFailed,
	releaseSignIn,
	type TProveRequest,
} from "./rpc-wire.js";

const BASE = "http://site.test:8123/instance/";
const METHOD = "Stepper-act";

describe("a call to a host's rpc", () => {
	it("is addressed under the host's base, carries its envelope, and is sent with the headers its proof makes over it", async () => {
		const proven: Parameters<TProveRequest>[0][] = [];
		const prove: TProveRequest = (request) => (proven.push(request), Promise.resolve({ ...request.headers, proof: "signed" }));
		const call = await buildRpcCall(BASE, { id: "call-1", method: METHOD, params: { what: 1 }, seqPath: [0, 1] }, prove);
		expect(call.url).toBe(`${BASE}rpc/${METHOD}`);
		expect(JSON.parse(call.init.body)).toEqual({ jsonrpc: "2.0", id: "call-1", method: METHOD, params: { what: 1 }, seqPath: [0, 1] });
		expect(proven, "the proof covers the request as it is sent, its host included").toEqual([
			{ url: call.url, method: "POST", headers: { "content-type": "application/json", host: "site.test:8123" }, body: call.init.body },
		]);
		expect(call.init.headers).toEqual({ "content-type": "application/json", host: "site.test:8123", proof: "signed" });
	});

	it("without a proof, is sent with its headers as they are", async () => {
		const call = await buildRpcCall(BASE, { id: "call-2", method: METHOD, params: {} }, provesNothing);
		expect(call.init.headers).toEqual({ "content-type": "application/json", host: "site.test:8123" });
	});

	it("carries the sign-in this process holds for the host beside its proof, which doesn't cover it, until it lets it go", async () => {
		const proven: Parameters<TProveRequest>[0][] = [];
		const prove: TProveRequest = (request) => (proven.push(request), Promise.resolve({ ...request.headers, proof: "signed" }));
		holdSignIn(BASE, { username: "reader", password: "a password" });
		const signedIn = await buildRpcCall(BASE, { id: "call-3", method: METHOD, params: {} }, prove);
		releaseSignIn(BASE);
		expect(proven[0]?.headers, "the proof covers the call, not the sign-in").toEqual({ "content-type": "application/json", host: "site.test:8123" });
		expect(signedIn.init.headers).toEqual({ "content-type": "application/json", host: "site.test:8123", proof: "signed", authorization: `Basic ${btoa("reader:a password")}` });
		expect(
			(await buildRpcCall("http://elsewhere.test", { id: "call-4", method: METHOD, params: {} }, provesNothing)).init.headers,
			"another host isn't sent it",
		).not.toHaveProperty("authorization");
		expect((await buildRpcCall(BASE, { id: "call-5", method: METHOD, params: {} }, provesNothing)).init.headers, "nor this host once it is let go").not.toHaveProperty(
			"authorization",
		);
	});
});

describe("a call a host parses", () => {
	const held = newActualityId();
	const refusal = (raw: Record<string, unknown>) => {
		const parsed = parseRpcRequest({ jsonrpc: "2.0", id: "call", method: METHOD, params: {}, ...raw }, held);
		return parsed.success ? undefined : parsed.refusal;
	};

	it("is read where it states the actuality the host holds", () => {
		expect(refusal({ actualityId: held })).toBeUndefined();
	});

	it("is refused where it states another actuality, and offers reading the actuality the host holds", () => {
		const other = newActualityId();
		const refused = refusal({ actualityId: other });
		const expected = actualityRefusal(other, held);
		expect(refused?.error).toContain(expected?.error);
		expect(refused?.remedy).toEqual(RELOAD.actuality);
	});

	it("is refused where it doesn't state an actuality, as a client older than the host doesn't, and offers reloading the client", () => {
		const refused = refusal({});
		expect(refused?.error).toContain(actualityRefusal(undefined, held)?.error);
		expect(refused?.remedy).toEqual(RELOAD.client);
	});

	it("is refused for another reason without a remedy where it states the actuality the host holds", () => {
		expect(refusal({ actualityId: held, params: "not an object" })?.remedy).toBeUndefined();
	});

	it("carries its refusal through a throw, and reads with its remedy where it isn't offered as a control", () => {
		const refused = new RefusedCall({ error: "refused", remedy: { do: "sign-in", at: "https://site.example" } });
		expect(refused.refusal.remedy).toEqual({ do: "sign-in", at: "https://site.example" });
		expect(refused.message).toBe("refused (sign in at https://site.example)");
		expect(refusalCarried(refused), "read by its name, as another bundle's copy of the class is").toEqual(refused.refusal);
		expect(refusalCarried(new Error("refused")), "a failure that isn't a refused call doesn't carry one").toBeUndefined();
		expect(authorityFailed({ error: "revoked", remedy: RELOAD.authority })).toBe(true);
		expect(authorityFailed(refused.refusal)).toBe(false);
	});
});
