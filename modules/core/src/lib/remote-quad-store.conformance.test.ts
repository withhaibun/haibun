// The store another instance serves, held to the same specification as the store it serves from: a satellite keeps its
// records in the main instance's store, so what a reader is given must not depend on which side holds them.
import { QuadStore } from "./quad-store.js";
import { RemoteQuadStore } from "./remote-quad-store.js";
import { handleStoreCall, isStoreMethod } from "./store-protocol.js";
import { describeQuadStore } from "./test/quad-store-conformance.js";
import { rpcAnswer } from "./test/rpc-answer.js";

const graphs = { first: "ConformanceFirst", second: "ConformanceSecond" };

/** The serving side, as the transport reaches it: the wire contract runs, so what JSON carries is what a caller is given. */
function servedBy(store: QuadStore): typeof fetch {
	return (async (url: string, init: { body: string }) => {
		const { method, params } = JSON.parse(init.body) as { method: string; params: Record<string, unknown> };
		if (method === "action.begin") return rpcAnswer({ hostId: 1, site: "did:example:serving" }, 200);
		if (!isStoreMethod(method)) return rpcAnswer({ error: `no such method ${method} at ${url}` }, 404);
		const answer = await handleStoreCall(store, method, params);
		return rpcAnswer(answer, 200);
	}) as unknown as typeof fetch;
}

describeQuadStore(
	"served by another instance",
	() => {
		const serving = new QuadStore();
		return new RemoteQuadStore({ url: "http://serving.example", token: "delegated", graphs: [graphs.first, graphs.second], fetchImpl: servedBy(serving) });
	},
	graphs,
);
