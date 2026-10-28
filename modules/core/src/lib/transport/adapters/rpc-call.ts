/**
 * The calls a process sends to the `/rpc` of a haibun host: each call built over the wire's envelope with the proof its
 * sender computes, the sign-ins this process holds for the sites it calls, and the handshake that begins every surface.
 */
import { MEDIA_TYPE } from "../../domains/media-types.js";
import { stripTrailingSlash } from "../../domains/local-origin.js";
import { basicAuthorization, type TBasicAuthUser } from "../../domains/basic-auth.js";
import {
	ACTION_BEGIN,
	answerBody,
	HandshakeSchema,
	protocolRefusal,
	provesNothing,
	RefusedCall,
	RPC_PROTOCOL,
	RPC_ROUTE,
	rpcEnvelope,
	StatedSchema,
	WITH_THE_SITES_SIGN_IN,
	type TActualityId,
	type THandshake,
	type TRpcCall,
	type TRpcEnvelope,
} from "../domains/rpc-wire.js";
import type { TProveRequest } from "../ports.js";

/** The sign-ins this process holds by origin, as a browser holds a sign-in for a site. Every call to an origin carries
 *  its sign-in beside the call's own proof. The `Signature` header carries the proof. */
const heldSignIns = new Map<string, Record<string, string>>();

/** Holds a basic-auth sign-in for `origin`. Each later call this process makes to `origin` carries it. */
export function holdSignIn(origin: string, user: TBasicAuthUser): void {
	heldSignIns.set(new URL(origin).origin, { authorization: basicAuthorization(user) });
}

/** Removes the sign-in held for `origin`. Call it once the server at `origin` has stopped. */
export function releaseSignIn(origin: string): void {
	heldSignIns.delete(new URL(origin).origin);
}

/**
 * Builds a call to the `/rpc` of the host at `base`. The call holds its URL, its envelope, and the headers that `prove`
 * computes over the request. Those headers include `host` as the host receives it. A sign-in held for the origin is
 * added after the proof, so the proof doesn't cover it. Every caller builds its calls here, so a signature covers the
 * same fields for every sender. A caller selects only how to send the call: once, with retries, or held open.
 */
export async function buildRpcCall(base: string, envelope: TRpcEnvelope, prove: TProveRequest): Promise<TRpcCall> {
	const url = `${stripTrailingSlash(base)}${RPC_ROUTE}${encodeURIComponent(envelope.method)}`;
	const body = rpcEnvelope(envelope);
	const headers = { "content-type": MEDIA_TYPE.json, host: new URL(url).host };
	const signedIn = heldSignIns.get(new URL(url).origin);
	return { url, init: { method: "POST", headers: { ...(await prove({ url, method: "POST", headers, body })), ...signedIn }, body, credentials: WITH_THE_SITES_SIGN_IN } };
}

/** Posts one call to `method` at the `/rpc` of the host at `base`. `prove` computes the call's proof headers. The host
 *  responds to a streamed call with NDJSON. A streamed call ends when its `signal` aborts. */
export async function postRpc(
	base: string,
	actualityId: TActualityId,
	method: string,
	params: Record<string, unknown>,
	prove: TProveRequest,
	stream?: { signal: AbortSignal },
): Promise<Response> {
	const call = await buildRpcCall(base, { id: `${method}-${Date.now()}`, method, params, actualityId, ...(stream ? { stream: true } : {}) }, prove);
	return await fetch(call.url, { ...call.init, signal: stream?.signal });
}

/** Sends the handshake to the host at `base` and returns the host's response. */
export async function handshakeAt(base: string, send: typeof fetch): Promise<THandshake> {
	const call = await buildRpcCall(base, { id: `${ACTION_BEGIN}-${Date.now()}`, method: ACTION_BEGIN, params: {} }, provesNothing);
	const answered = await answerBody(ACTION_BEGIN, await send(call.url, call.init));
	// A response at another protocol version is refused for its version before the rest of the response is parsed.
	const otherProtocol = protocolRefusal(RPC_PROTOCOL, StatedSchema.safeParse(answered).data?.protocol);
	if (otherProtocol) throw new RefusedCall(otherProtocol);
	return HandshakeSchema.parse(answered);
}

/** Returns the actualityId of the records the host at `base` holds. */
export const actualityAt = async (base: string): Promise<TActualityId> => (await handshakeAt(base, fetch)).actualityId;
