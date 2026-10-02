import { answeringTheHandshake } from "./test/rpc-answer.js";
import { notFromActuality } from "./rpc-wire.js";
import { describe, it, expect } from "vitest";
import { RpcCallFailed, RpcClient } from "./rpc-client.js";
import type { TOutgoingRequest, TRequestSigner } from "./authority-types.js";

/**
 * Build a fake fetch that records calls and returns scripted responses.
 * Responses is an array; each call pops the next one. If exhausted, the
 * fake throws: that surfaces unexpected extra calls as a clear failure.
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
		const status = spec.status ?? (spec.ok === false ? 500 : 200);
		const encoder = new TextEncoder();
		const body = spec.bodyStream
			? new ReadableStream<Uint8Array>({
					start(controller) {
						for (const c of spec.bodyStream ?? []) controller.enqueue(encoder.encode(c));
						controller.close();
					},
				})
			: (spec.bodyText ?? "{}");
		return new Response(body, { status, headers: { "Content-Type": spec.bodyStream ? "application/x-ndjson" : "application/json" } });
	};
	return { fetchImpl: answeringTheHandshake(fetchImpl), calls };
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

	it("signs a call that invokes an action over the address, the method and the body it sends", async () => {
		const { fetchImpl, calls } = makeFakeFetch([{ ok: true, bodyText: "{}" }]);
		const signed: Array<{ request: TOutgoingRequest; action: string }> = [];
		const sign: TRequestSigner = (request, action) => {
			signed.push({ request, action });
			return Promise.resolve({ ...request.headers, "capability-invocation": `signed action="${action}"` });
		};
		const client = new RpcClient({ baseUrl: "http://host", sign, fetchImpl });
		await client.call("m", {}, [0], { action: "Stepper:act" });
		expect(signed).toEqual([
			{ request: { method: "POST", url: "http://host/rpc/m", headers: { "content-type": "application/json", host: "host" }, body: calls[0].init?.body }, action: "Stepper:act" },
		]);
		expect(calls[0].init?.headers).toEqual({ "content-type": "application/json", host: "host", "capability-invocation": 'signed action="Stepper:act"' });
	});

	it("sends a call that doesn't invoke an action unsigned", async () => {
		const { fetchImpl, calls } = makeFakeFetch([{ ok: true, bodyText: "{}" }]);
		const sign: TRequestSigner = () => Promise.reject(new Error("a call invoking nothing is not signed"));
		const client = new RpcClient({ baseUrl: "http://host", sign, fetchImpl });
		await client.call("m", {}, [0]);
		expect(calls[0].init?.headers).toEqual({ "content-type": "application/json", host: "host" });
	});

	it("refuses a call invoking an action when it doesn't hold a signer, before sending a request", async () => {
		const { fetchImpl, calls } = makeFakeFetch([{ ok: true, bodyText: "{}" }]);
		const client = new RpcClient({ baseUrl: "http://host", fetchImpl });
		await expect(client.call("m", {}, [0], { action: "Stepper:act" })).rejects.toThrow("a call invoking Stepper:act is signed, and this client doesn't hold a signer");
		expect(calls).toEqual([]);
	});

	it("refuses a call its signer refuses, once, without retrying it as a network fault", async () => {
		const { fetchImpl, calls } = makeFakeFetch([{ ok: true, bodyText: "{}" }]);
		let asked = 0;
		const sign: TRequestSigner = () => {
			asked++;
			return Promise.reject(new Error("no delegation allows Stepper:act"));
		};
		const client = new RpcClient({ baseUrl: "http://host", sign, fetchImpl, retry: { maxAttempts: 3, baseDelayMs: 0 } });
		await expect(client.call("m", {}, [0], { action: "Stepper:act" })).rejects.toThrow("no delegation allows Stepper:act");
		expect([asked, calls.length]).toEqual([1, 0]);
	});

	it("refuses an answer that is not JSON with its status and what the server sent, as a path it does not serve answers", async () => {
		const fetchImpl: typeof fetch = () => Promise.resolve(new Response("404 Not Found", { status: 404, headers: { "Content-Type": "text/plain" } }));
		const client = new RpcClient({ baseUrl: "http://host", fetchImpl: answeringTheHandshake(fetchImpl) });
		await expect(client.call("Stepper-echo", {}, [0])).rejects.toThrow(
			new RpcCallFailed("Stepper-echo", "http://host", notFromActuality("Stepper-echo", 404, "text/plain", "404 Not Found").error),
		);
	});

	it("surfaces application errors (HTTP 422 with error body) intact", async () => {
		const { fetchImpl } = makeFakeFetch([{ ok: false, status: 422, bodyText: JSON.stringify({ error: "capability Foo required" }) }]);
		const client = new RpcClient({ baseUrl: "http://host", fetchImpl, retry: { maxAttempts: 1 } });
		await expect(client.call("m", {}, [0])).rejects.toThrow(new RpcCallFailed("m", "http://host", "capability Foo required"));
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

	it("throws RpcCallFailed, naming the attempts, once every retry fails", async () => {
		const { fetchImpl, calls } = makeFakeFetch([{ throwError: new Error("boom") }, { throwError: new Error("boom") }]);
		const client = new RpcClient({
			baseUrl: "http://host",
			fetchImpl,
			retry: { maxAttempts: 2, baseDelayMs: 0 },
		});
		await expect(client.call("m", {}, [0])).rejects.toThrow(/m at http:\/\/host: rpc failed after 2 attempts/);
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

	// Every line on this wire is written by JSON.stringify, so a line that will not parse is something else writing into
	// the response. Skipping it silently drops a chunk of an answer without an error; the stream stops instead.
	it("throws on a malformed line, naming what it read", async () => {
		const { fetchImpl } = makeFakeFetch([{ ok: true, bodyStream: ['{"ok":1}\n', "not-json\n", '{"ok":2}\n'] }]);
		const client = new RpcClient({ baseUrl: "http://host", fetchImpl });
		const out: unknown[] = [];
		await expect(async () => {
			for await (const chunk of client.stream("m", {}, [0])) out.push(chunk);
		}).rejects.toThrow(/not JSON: not-json/);
		expect(out).toEqual([{ ok: 1 }]);
	});
});

describe("what a caller is told when a call's answer didn't come from actuality", () => {
	it("reports what answered in front of it, and offers signing in at the site where a sign-in was refused", () => {
		expect(notFromActuality("Stepper-echo", 401, "text/plain", "401 Unauthorized\n", "https://site.example")).toEqual({
			error: "Stepper-echo: this call didn't reach actuality. Something in front of it answered 401 (text/plain): 401 Unauthorized.",
			remedy: { do: "sign-in", at: "https://site.example" },
		});
		expect(notFromActuality("Stepper-echo", 401, "text/plain", "401 Unauthorized"), "where the answer doesn't state the site, it isn't offered").not.toHaveProperty("remedy");
		expect(notFromActuality("Stepper-echo", 502, "text/html", "Bad Gateway", "https://site.example")).toEqual({
			error: "Stepper-echo: this call didn't reach actuality. Something in front of it answered 502 (text/html): Bad Gateway.",
		});
	});
});
