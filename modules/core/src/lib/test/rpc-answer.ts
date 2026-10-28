import { MEDIA_TYPE } from "../domains/media-types.js";
import { ACTION_BEGIN, RPC_PROTOCOL, RPC_ROUTE, newActualityId, type THandshake } from "../transport/domains/rpc-wire.js";

/** Returns a host response as actuality sends one. The body is JSON, and `status` reports whether the host served the call. */
export const rpcAnswer = (body: unknown, status: number): Response => new Response(JSON.stringify(body), { status, headers: { "Content-Type": MEDIA_TYPE.json } });

/** The path where a stand-in host responds to the handshake. */
export const HANDSHAKE_PATH = `${RPC_ROUTE}${ACTION_BEGIN}`;

/** Returns the handshake a stand-in host sends as host `hostId` of `site`. */
export const hostHandshake = (hostId: number, site: string): THandshake & { seqPath: number[] } => ({
	seqPath: [hostId, -1, 1],
	protocol: RPC_PROTOCOL,
	hostId,
	site,
	actualityId: HOST_ACTUALITY,
	serving: true,
});

/** The actuality id that a stand-in host's handshake reports. */
export const HOST_ACTUALITY = newActualityId();

/** Wraps `fetchImpl`. The wrapper returns a stand-in host's handshake for a handshake request and passes every other request to `fetchImpl`. */
export const answeringTheHandshake =
	(fetchImpl: typeof fetch): typeof fetch =>
	(input, init) =>
		String(input instanceof Request ? input.url : input).endsWith(HANDSHAKE_PATH) ? Promise.resolve(rpcAnswer(hostHandshake(0, "did:site:0"), 200)) : fetchImpl(input, init);
