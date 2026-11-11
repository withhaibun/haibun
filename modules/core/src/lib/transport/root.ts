/**
 * The composition root of the transport: the client through which a proxy calls a remote host's steps.
 */
import type { TRequestSigner } from "../domains/authority-types.js";
import type { TRemoteCall } from "./domains/rpc-wire.js";
import type { TRemoteSteps } from "./ports.js";
import { RpcCallFailed, RpcClient } from "./adapters/rpc-client.js";
import { refusalCarried, refusalSaid } from "./domains/rpc-wire.js";

/** The steps of the host at `baseUrl`, each call signed through `sign`. A call the host refused, a call its signer refused,
 *  or one that didn't reach the host after every attempt, is the failure of its step; every other failure throws. */
export function remoteSteps(baseUrl: string, sign: TRequestSigner): TRemoteSteps {
	const rpc = new RpcClient({ baseUrl, sign });
	const failed = (e: unknown): TRemoteCall => {
		if (e instanceof RpcCallFailed) return { served: false, reason: e.answered ? e.reason : e.message };
		const refused = refusalCarried(e);
		if (refused !== undefined) return { served: false, reason: refusalSaid(refused) };
		throw e;
	};
	return {
		handshake: () => rpc.handshake(),
		call: (method, params, under, action) => rpc.call(method, params, under, { action }).then((result): TRemoteCall => ({ served: true, result }), failed),
	};
}
