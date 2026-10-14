// The store another instance serves, held to the same specification as the store it serves from: a satellite keeps its
// records in the main instance's store, so what a reader is given must not depend on which side holds them.
import { ACTION_BEGIN, callFailed } from "./rpc-wire.js";
import { errorDetail } from "./util/index.js";
import { QuadStore, newStoreChain } from "./steps/pipelines/quad-store.js";
import { RemoteQuadStore } from "./remote-quad-store.js";
import { handleStoreCall, isStoreMethod } from "./store-protocol.js";
import { CONFORMANCE_TYPES, describeQuadStore } from "./test/quad-store-conformance.js";
import { readDeclarationsOf } from "./records/derivations/read-records.js";
import { hostHandshake, rpcAnswer } from "./test/rpc-answer.js";
import { FakeInvoker } from "./test/fake-authority.js";

/** The status the server's transport returns for a call whose handler failed. */
const CALL_FAILED_STATUS = 422;

/** The serving side, as the transport reaches it: the wire contract runs, so what JSON carries is what a caller is given. It
 *  returns a store's rejection as a failed call, as the server does. */
function servedBy(store: QuadStore): typeof fetch {
	return (async (url: string, init: { body: string }) => {
		const { method, params } = JSON.parse(init.body) as { method: string; params: Record<string, unknown> };
		if (method === ACTION_BEGIN) return rpcAnswer(hostHandshake(1, "did:example:serving"), 200);
		if (!isStoreMethod(method)) return rpcAnswer({ error: `no such method ${method} at ${url}` }, 404);
		try {
			return rpcAnswer(await handleStoreCall(store, method, params), 200);
		} catch (err) {
			return rpcAnswer(callFailed(method, errorDetail(err)), CALL_FAILED_STATUS);
		}
	}) as unknown as typeof fetch;
}

describeQuadStore("served by another instance", (domains) => {
	const serving = new QuadStore(newStoreChain(), undefined, () => readDeclarationsOf(domains));
	return new RemoteQuadStore({ url: "http://serving.example", sign: new FakeInvoker("delegated").sign, graphs: Object.values(CONFORMANCE_TYPES), fetchImpl: servedBy(serving) });
});
