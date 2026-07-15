import { describe, expect, it } from "vitest";
import { QuadStore } from "./quad-store.js";
import { handleStoreCall, isStoreMethod } from "./store-protocol.js";
import { RemoteQuadStore } from "./remote-quad-store.js";

/** A canned serving instance: a real in-memory QuadStore behind the real protocol handler, plus the handshake. */
function servingPeer(store: QuadStore) {
	const calls: Array<{ method: string; params: Record<string, unknown>; authorization?: string }> = [];
	const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const body = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> };
		const headers = init?.headers as Record<string, string>;
		calls.push({ method: body.method, params: body.params, authorization: headers.Authorization });
		const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
		if (body.method === "action.begin") return json({ seqPath: [7, -1, 1], hostId: 7, site: "did:site:main" });
		if (!isStoreMethod(body.method)) return json({ error: `unexpected ${body.method}` }, 422);
		try {
			return json(await handleStoreCall(store, body.method, body.params));
		} catch (err) {
			return json({ error: String(err) }, 422);
		}
	};
	return { calls, fetchImpl: fetchImpl as typeof fetch };
}

describe("RemoteQuadStore", () => {
	it("handshakes the serving site, presents the delegated token on every call, and round-trips individuals", async () => {
		const backing = new QuadStore();
		const peer = servingPeer(backing);
		const remote = new RemoteQuadStore({ url: "http://main:1", token: "sat-token", graphs: ["Widget"], fetchImpl: peer.fetchImpl });
		expect(() => remote.site).toThrow(/connect/);
		expect(await remote.connect()).toBe("did:site:main");
		expect(await remote.upsertIndividual("Widget", { id: "w-1", name: "One" })).toBe("w-1");
		expect(await remote.getIndividual("Widget", "w-1")).toEqual({ id: "w-1", name: "One" });
		expect(await backing.getIndividual("Widget", "w-1")).toEqual({ id: "w-1", name: "One" });
		for (const c of peer.calls) expect(c.authorization).toBe("Bearer sat-token");
	});

	it("routes through QuadStore registration: a satellite write lands in the serving store, reads come back", async () => {
		const backing = new QuadStore();
		const peer = servingPeer(backing);
		const remote = new RemoteQuadStore({ url: "http://main:1", token: "sat-token", graphs: ["Widget"], fetchImpl: peer.fetchImpl });
		await remote.connect();
		const satellite = new QuadStore();
		await satellite.registerStore(remote, ["Widget"]);
		await satellite.upsertIndividual("Widget", { id: "w-9", name: "Nine" });
		expect(await backing.getIndividual("Widget", "w-9")).toEqual({ id: "w-9", name: "Nine" });
		expect(await satellite.queryIndividuals("Widget", { id: "w-9" })).toEqual([{ id: "w-9", name: "Nine" }]);
	});

	it("stays mount-scoped: all() covers only the mounted graphs and clustered reads intersect the type filter", async () => {
		const backing = new QuadStore();
		await backing.add({ subject: "w-1", predicate: "name", object: "One", namedGraph: "Widget" });
		await backing.add({ subject: "p-1", predicate: "name", object: "Private", namedGraph: "Elsewhere" });
		const peer = servingPeer(backing);
		const remote = new RemoteQuadStore({ url: "http://main:1", token: "sat-token", graphs: ["Widget"], fetchImpl: peer.fetchImpl });
		await remote.connect();
		expect((await remote.all()).map((q) => q.namedGraph)).toEqual(["Widget"]);
		const clustered = await remote.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private" });
		expect(clustered.clusters.map((c) => c.type)).toEqual(["Widget"]);
		expect(await remote.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private", types: ["Elsewhere"] })).toEqual({ quads: [], clusters: [] });
	});

	it("surfaces a serving-side refusal as an error, never a silent empty result", async () => {
		const denyingFetch = ((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const body = JSON.parse(String(init?.body)) as { method: string };
			const json = (v: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } }));
			if (body.method === "action.begin") return json({ seqPath: [7, -1, 1], hostId: 7, site: "did:site:main" });
			return json({ error: `${body.method}: capability store.write required` }, 422);
		}) as typeof fetch;
		const denied = new RemoteQuadStore({ url: "http://main:1", token: "wrong", graphs: ["Widget"], fetchImpl: denyingFetch });
		await denied.connect();
		await expect(denied.upsertIndividual("Widget", { id: "w-1" })).rejects.toThrow(/capability store.write required/);
	});
});
