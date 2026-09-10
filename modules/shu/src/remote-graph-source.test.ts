import { describe, expect, it } from "vitest";
import { RemoteGraphSource } from "./remote-graph-source.js";
import { RPC_METHOD } from "./consts.js";

/** A canned peer: action.begin self-reports the site; getClusteredQuads serves one Email cluster with one pre-stamped subject. */
const readRequests: Record<string, unknown>[] = [];
const peerFetch =
	(beginBody: Record<string, unknown>) =>
	(input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		if (url.endsWith("/rpc/action.begin")) return Promise.resolve(new Response(JSON.stringify(beginBody), { status: 200, headers: { "Content-Type": "application/json" } }));
		if (url.endsWith(`/rpc/${RPC_METHOD.CLUSTERED_QUADS}`)) {
			readRequests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
			const body = {
				quads: [
					{ subject: "m-1", predicate: "name", object: "One", namedGraph: "Email", timestamp: 1 },
					{ subject: "m-2", predicate: "name", object: "Two", namedGraph: "Email", timestamp: 2 },
				],
				clusters: [
					{
						type: "Email",
						totalCount: 2,
						sampledCount: 2,
						omittedCount: 0,
						sampledSubjects: ["m-1", "m-2"],
						displayLabels: { "m-1": "One", "m-2": "Two" },
						sites: { "m-2": "did:site:deeper" },
					},
				],
				site: "did:site:imap",
			};
			return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
		}
		return Promise.resolve(new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 422, headers: { "Content-Type": "application/json" } }));
	};

describe("RemoteGraphSource", () => {
	it("handshakes the peer's site principal and refuses reads before connect", async () => {
		const source = new RemoteGraphSource({ url: "http://peer:1", fetchImpl: peerFetch({ seqPath: [7, -1, 1], hostId: 7, site: "did:site:imap" }) as typeof fetch });
		expect(() => source.site).toThrow(/connect/);
		expect(await source.connect()).toBe("did:site:imap");
		expect(source.site).toBe("did:site:imap");
	});

	it("fails fast on a peer that predates federation (action.begin without a site)", async () => {
		const source = new RemoteGraphSource({ url: "http://peer:1", fetchImpl: peerFetch({ seqPath: [7, -1, 1], hostId: 7 }) as typeof fetch });
		await expect(source.connect()).rejects.toThrow(/did not report a site principal/);
	});

	it("asks for the peer's OWN data (scope own: a federation cycle cannot recurse) and stamps EVERY sampled subject, keeping stamps the peer set itself", async () => {
		const source = new RemoteGraphSource({ url: "http://peer:1", fetchImpl: peerFetch({ seqPath: [7, -1, 1], hostId: 7, site: "did:site:imap" }) as typeof fetch });
		await source.connect();
		const result = await source.getClusteredQuads({ perTypeLimit: 10, accessLevel: "private" });
		const lastParams = readRequests.at(-1)?.params as Record<string, unknown> | undefined;
		if (!lastParams) throw new Error("the peer was never asked for its clustered quads");
		expect(lastParams.scope).toBe("own");
		expect(result.site).toBe("did:site:imap");
		expect(result.clusters[0].sites).toEqual({ "m-1": "did:site:imap", "m-2": "did:site:deeper" });
	});
});
