import { ACTION_BEGIN, RPC_ROUTE, newActualityId, type THandshake } from "../rpc-wire.js";

/** A host's answer as actuality sends one: JSON, with the status that states whether it served the call. */
export const rpcAnswer = (body: unknown, status: number): Response => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Where a host a test stands in for answers the handshake. */
export const HANDSHAKE_PATH = `${RPC_ROUTE}${ACTION_BEGIN}`;

/** What a host a test stands in for answers the handshake with, as host `hostId` of `site`. */
export const hostHandshake = (hostId: number, site: string): THandshake & { seqPath: number[] } => ({
	seqPath: [hostId, -1, 1],
	hostId,
	site,
	actualityId: HOST_ACTUALITY,
	serving: true,
});

/** The actuality of the records a host a test stands in for holds. */
export const HOST_ACTUALITY = newActualityId();

/** `fetchImpl`, answering the handshake as a host a test stands in for does and every other request as `fetchImpl` does. */
export const answeringTheHandshake =
	(fetchImpl: typeof fetch): typeof fetch =>
	(input, init) =>
		String(input instanceof Request ? input.url : input).endsWith(HANDSHAKE_PATH) ? Promise.resolve(rpcAnswer(hostHandshake(0, "did:site:0"), 200)) : fetchImpl(input, init);
