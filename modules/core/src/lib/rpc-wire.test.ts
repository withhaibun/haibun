/**
 * Tests the RPC wire: the call that buildRpcCall builds, a host's parse of a call, and the protocol version. buildRpcCall
 * builds the call to a host's `/rpc` for every caller. The call holds its URL under the host's base, its envelope, and
 * the headers that `prove` computes over the request as it is sent. Those headers include the request's `host`. A call
 * that doesn't carry a proof is sent with those headers unchanged.
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
	RPC_PROTOCOL,
	protocolRefusal,
	handshakeAt,
	HandshakeSchema,
	RpcRequestSchema,
	RpcRefusalSchema,
	RpcResponseSchema,
	RpcStreamSchema,
} from "./rpc-wire.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { hostHandshake, rpcAnswer } from "./test/rpc-answer.js";

const BASE = "http://site.test:8123/instance/";
const METHOD = "Stepper-act";
const ACTUALITY = newActualityId();

describe("a call to a host's rpc", () => {
	it("is addressed under the host's base, carries its envelope, and is sent with the proof headers computed over it", async () => {
		const proven: Parameters<TProveRequest>[0][] = [];
		const prove: TProveRequest = (request) => (proven.push(request), Promise.resolve({ ...request.headers, proof: "signed" }));
		const call = await buildRpcCall(BASE, { id: "call-1", actualityId: ACTUALITY, method: METHOD, params: { what: 1 }, seqPath: [0, 1] }, prove);
		expect(call.url).toBe(`${BASE}rpc/${METHOD}`);
		expect(JSON.parse(call.init.body)).toEqual({
			jsonrpc: "2.0",
			protocol: RPC_PROTOCOL,
			id: "call-1",
			actualityId: ACTUALITY,
			method: METHOD,
			params: { what: 1 },
			seqPath: [0, 1],
		});
		expect(proven, "the proof covers the request as it is sent, including its host").toEqual([
			{ url: call.url, method: "POST", headers: { "content-type": "application/json", host: "site.test:8123" }, body: call.init.body },
		]);
		expect(call.init.headers).toEqual({ "content-type": "application/json", host: "site.test:8123", proof: "signed" });
	});

	it("is sent with its headers unchanged where it doesn't carry a proof", async () => {
		const call = await buildRpcCall(BASE, { id: "call-2", actualityId: ACTUALITY, method: METHOD, params: {} }, provesNothing);
		expect(call.init.headers).toEqual({ "content-type": "application/json", host: "site.test:8123" });
	});

	it("carries the sign-in this process holds for the host outside its proof until the process releases it", async () => {
		const proven: Parameters<TProveRequest>[0][] = [];
		const prove: TProveRequest = (request) => (proven.push(request), Promise.resolve({ ...request.headers, proof: "signed" }));
		holdSignIn(BASE, { username: "reader", password: "a password" });
		const signedIn = await buildRpcCall(BASE, { id: "call-3", actualityId: ACTUALITY, method: METHOD, params: {} }, prove);
		releaseSignIn(BASE);
		expect(proven[0]?.headers, "the proof covers the call and doesn't cover the sign-in").toEqual({ "content-type": "application/json", host: "site.test:8123" });
		expect(signedIn.init.headers).toEqual({ "content-type": "application/json", host: "site.test:8123", proof: "signed", authorization: `Basic ${btoa("reader:a password")}` });
		expect(
			(await buildRpcCall("http://elsewhere.test", { id: "call-4", actualityId: ACTUALITY, method: METHOD, params: {} }, provesNothing)).init.headers,
			"a call to another host doesn't carry the sign-in",
		).not.toHaveProperty("authorization");
		expect(
			(await buildRpcCall(BASE, { id: "call-5", actualityId: ACTUALITY, method: METHOD, params: {} }, provesNothing)).init.headers,
			"a call to this host doesn't carry the sign-in after its release",
		).not.toHaveProperty("authorization");
	});
});

describe("a call a host parses", () => {
	const held = newActualityId();
	const refusal = (raw: Record<string, unknown>) => {
		const parsed = parseRpcRequest({ jsonrpc: "2.0", protocol: RPC_PROTOCOL, id: "call", method: METHOD, params: {}, ...raw }, held);
		return parsed.success ? undefined : parsed.refusal;
	};

	it("is parsed where it states the actuality the host holds", () => {
		expect(refusal({ actualityId: held })).toBeUndefined();
	});

	it("is refused where it states another actuality, with a remedy that reads the host's actuality", () => {
		const other = newActualityId();
		const refused = refusal({ actualityId: other });
		const expected = actualityRefusal(other, held);
		expect(refused?.error).toContain(expected?.error);
		expect(refused?.remedy).toEqual(RELOAD.actuality);
	});

	it("is refused for another protocol version before the rest of the call is parsed", () => {
		expect(refusal({ protocol: undefined }), "a client that doesn't state a version").toEqual(protocolRefusal(undefined, RPC_PROTOCOL));
		expect(refusal({ protocol: RPC_PROTOCOL - 1, actualityId: newActualityId() }), "an older client is refused for its version whatever actuality it reads").toEqual(
			protocolRefusal(RPC_PROTOCOL - 1, RPC_PROTOCOL),
		);
		expect(refusal({})?.remedy, "a call at this version that doesn't name an actuality is malformed").toBeUndefined();
	});

	it("is refused for another reason without a remedy where it states the actuality the host holds", () => {
		expect(refusal({ actualityId: held, params: "not an object" })?.remedy).toBeUndefined();
	});

	it("carries its refusal when thrown, and its message includes the remedy as text", () => {
		const refused = new RefusedCall({ error: "refused", remedy: { do: "sign-in", at: "https://site.example" } });
		expect(refused.refusal.remedy).toEqual({ do: "sign-in", at: "https://site.example" });
		expect(refused.message).toBe("refused (sign in at https://site.example)");
		expect(refusalCarried(refused), "matched by its name, so another bundle's copy of the class matches too").toEqual(refused.refusal);
		expect(refusalCarried(new Error("refused")), "a failure that isn't a refused call doesn't carry one").toBeUndefined();
		expect(authorityFailed({ error: "revoked", remedy: RELOAD.authority })).toBe(true);
		expect(authorityFailed(refused.refusal)).toBe(false);
	});
});

/** The wire's shape at each protocol version. A change to the fields of a call, a response, a stream chunk, a refusal or
 *  the handshake response requires a higher RPC_PROTOCOL. Record the new shape here under the new version. */
const WIRE_AT: Record<number, string> = { 1: "8779e89c5a24b9f7" };
const wireShape = (): string =>
	createHash("sha256")
		.update(
			JSON.stringify(
				[RpcRequestSchema, HandshakeSchema, RpcRefusalSchema, RpcResponseSchema, RpcStreamSchema].map((schema) => z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })),
			),
		)
		.digest("hex")
		.slice(0, 16);

describe("the RPC protocol", () => {
	it("has the wire shape recorded for its version", () => {
		expect(wireShape(), "the wire's shape changed: raise RPC_PROTOCOL and record the new shape under the new version").toBe(WIRE_AT[RPC_PROTOCOL]);
	});

	it("states which of a client and an instance is older, and offers a reload to an older client", () => {
		expect(protocolRefusal(RPC_PROTOCOL, RPC_PROTOCOL)).toBeUndefined();
		expect(protocolRefusal(undefined, 2)).toEqual({
			error: "This client is older than the instance. The client's RPC protocol is a version from before versions were stated. The instance's RPC protocol is version 2.",
			remedy: RELOAD.client,
		});
		expect(protocolRefusal(2, 1)).toEqual({
			error: "The instance is older than this client. The client's RPC protocol is version 2. The instance's RPC protocol is version 1.",
			remedy: undefined,
		});
	});

	it("refuses a handshake response from an instance at another version", async () => {
		const answering =
			(protocol: unknown): typeof fetch =>
			() =>
				Promise.resolve(rpcAnswer({ ...hostHandshake(0, "did:site:0"), protocol }, 200));
		await expect(handshakeAt(BASE, answering(RPC_PROTOCOL - 1))).rejects.toThrow(protocolRefusal(RPC_PROTOCOL, RPC_PROTOCOL - 1)?.error);
		await expect(handshakeAt(BASE, answering(undefined))).rejects.toThrow(protocolRefusal(RPC_PROTOCOL, undefined)?.error);
		expect((await handshakeAt(BASE, answering(RPC_PROTOCOL))).protocol).toBe(RPC_PROTOCOL);
	});
});
