import { describe, it, expect } from "vitest";
import { RpcClient, type RpcError } from "./rpc-client.js";

/**
 * Build a fake fetch that records calls and returns scripted responses.
 * Responses is an array; each call pops the next one. If exhausted, the
 * fake throws — that surfaces unexpected extra calls as a clear failure.
 */
type Scripted = Partial<Response> & { bodyText?: string; bodyStream?: string[]; throwError?: Error };

function makeFakeFetch(responses: Scripted[]): { fetchImpl: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	let idx = 0;
	const fetchImpl: typeof fetch = async (input, init) => {
		await Promise.resolve(); // await for lint; also ensures the handler is a microtask, closer to real fetch semantics
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
		calls.push({ url, init });
		if (idx >= responses.length) throw new Error(`fake fetch exhausted after ${idx} calls`);
		const spec = responses[idx++];
		if (spec.throwError) throw spec.throwError;
		const ok = spec.ok ?? true;
		const status = spec.status ?? (ok ? 200 : 500);
		const bodyText = spec.bodyText ?? "{}";
		const chunks = spec.bodyStream;
		const response: Partial<Response> = {
			ok,
			status,
			text: async () => bodyText,
			json: async () => JSON.parse(bodyText),
			body: chunks
				? new ReadableStream<Uint8Array>({
						start(controller) {
							const encoder = new TextEncoder();
							for (const c of chunks) controller.enqueue(encoder.encode(c));
							controller.close();
						},
					})
				: null,
		};
		return response as Response;
	};
	return { fetchImpl, calls };
}

describe("RpcClient.call", () => {
	it("posts JSON-RPC 2.0 body with method, params, and seqPath", async () => {
		const { fetchImpl, calls } = makeFakeFetch([{ ok: true, bodyText: JSON.stringify({ result: 42 }) }]);
		const client = new RpcClient({ baseUrl: "http://host", fetchImpl });
		const out = await client.call<{ result: number }>("Stepper-echo", { message: "hi" }, [0, 1, 2, 3]);
		expect((out as { result: number }).result).toBe(42);
		const body = JSON.parse(String(calls[0].init?.body));
		expect(body.jsonrpc).toBe("2.0");
		expect(body.method).toBe("Stepper-echo");
		expect(body.params).toEqual({ message: "hi" });
		expect(body.seqPath).toEqual([0, 1, 2, 3]);
	});

	it("attaches Bearer token when capabilityToken is configured", async () => {
		const { fetchImpl, calls } = makeFakeFetch([{ ok: true, bodyText: "{}" }]);
		const client = new RpcClient({ baseUrl: "http://host", capabilityToken: "secret", fetchImpl });
		await client.call("m", {}, [0]);
		const headers = calls[0].init?.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer secret");
	});

	it("omits Authorization when no token", async () => {
		const { fetchImpl, calls } = makeFakeFetch([{ ok: true, bodyText: "{}" }]);
		const client = new RpcClient({ baseUrl: "http://host", fetchImpl });
		await client.call("m", {}, [0]);
		const headers = calls[0].init?.headers as Record<string, string>;
		expect(headers.Authorization).toBeUndefined();
	});

	it("surfaces application errors (HTTP 422 with error body) intact", async () => {
		const { fetchImpl } = makeFakeFetch([{ ok: false, status: 422, bodyText: JSON.stringify({ error: "capability Foo required" }) }]);
		const client = new RpcClient({ baseUrl: "http://host", fetchImpl, retry: { maxAttempts: 1 } });
		const out = await client.call("m", {}, [0]);
		expect((out as RpcError).error).toBe("capability Foo required");
	});

	it("retries on network error and succeeds on a later attempt", async () => {
		const { fetchImpl, calls } = makeFakeFetch([{ throwError: new Error("ECONNREFUSED") }, { ok: true, bodyText: JSON.stringify({ ok: true }) }]);
		const client = new RpcClient({
			baseUrl: "http://host",
			fetchImpl,
			retry: { maxAttempts: 3, baseDelayMs: 0 },
		});
		const out = await client.call<{ ok: boolean }>("m", {}, [0]);
		expect((out as { ok: boolean }).ok).toBe(true);
		expect(calls.length).toBe(2);
	});

	it("returns an RpcError with attempt count after all retries exhausted", async () => {
		const { fetchImpl, calls } = makeFakeFetch([{ throwError: new Error("boom") }, { throwError: new Error("boom") }]);
		const client = new RpcClient({
			baseUrl: "http://host",
			fetchImpl,
			retry: { maxAttempts: 2, baseDelayMs: 0 },
		});
		const out = await client.call("m", {}, [0]);
		expect((out as RpcError).error).toMatch(/2 attempts/);
		expect(calls.length).toBe(2);
	});

	it("URL-encodes the method name", async () => {
		const { fetchImpl, calls } = makeFakeFetch([{ ok: true, bodyText: "{}" }]);
		const client = new RpcClient({ baseUrl: "http://host", fetchImpl });
		await client.call("Stepper/odd name", {}, [0]);
		expect(calls[0].url).toMatch(/Stepper%2Fodd%20name/);
	});

	it("strips a trailing slash from baseUrl", async () => {
		const { fetchImpl, calls } = makeFakeFetch([{ ok: true, bodyText: "{}" }]);
		const client = new RpcClient({ baseUrl: "http://host/", fetchImpl });
		await client.call("m", {}, [0]);
		expect(calls[0].url).toBe("http://host/rpc/m");
	});
});

describe("RpcClient.stream", () => {
	it("yields one parsed object per NDJSON line", async () => {
		const { fetchImpl } = makeFakeFetch([
			{
				ok: true,
				bodyStream: ['{"chunk":1}\n', '{"chunk":2}\n{"chunk":3}\n'],
			},
		]);
		const client = new RpcClient({ baseUrl: "http://host", fetchImpl });
		const out: unknown[] = [];
		for await (const chunk of client.stream<{ chunk: number }>("m", {}, [0])) out.push(chunk);
		expect(out).toEqual([{ chunk: 1 }, { chunk: 2 }, { chunk: 3 }]);
	});

	it("yields a final chunk missing a trailing newline", async () => {
		const { fetchImpl } = makeFakeFetch([{ ok: true, bodyStream: ['{"a":1}\n{"b":2}'] }]);
		const client = new RpcClient({ baseUrl: "http://host", fetchImpl });
		const out: unknown[] = [];
		for await (const chunk of client.stream("m", {}, [0])) out.push(chunk);
		expect(out).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it("sets stream:true in the request body", async () => {
		const { fetchImpl, calls } = makeFakeFetch([{ ok: true, bodyStream: [] }]);
		const client = new RpcClient({ baseUrl: "http://host", fetchImpl });
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		for await (const _ of client.stream("m", {}, [0])) {
			/* empty */
		}
		const body = JSON.parse(String(calls[0].init?.body));
		expect(body.stream).toBe(true);
	});

	it("throws with the response status when server returns non-OK", async () => {
		const { fetchImpl } = makeFakeFetch([{ ok: false, status: 500, bodyStream: [] }]);
		const client = new RpcClient({ baseUrl: "http://host", fetchImpl });
		await expect(async () => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			for await (const _ of client.stream("m", {}, [0])) {
				/* empty */
			}
		}).rejects.toThrow(/HTTP 500/);
	});

	it("tolerates a malformed line without aborting the stream", async () => {
		const { fetchImpl } = makeFakeFetch([{ ok: true, bodyStream: ['{"ok":1}\n', "not-json\n", '{"ok":2}\n'] }]);
		const client = new RpcClient({ baseUrl: "http://host", fetchImpl });
		const out: unknown[] = [];
		for await (const chunk of client.stream("m", {}, [0])) out.push(chunk);
		expect(out).toEqual([{ ok: 1 }, { ok: 2 }]);
	});
});
