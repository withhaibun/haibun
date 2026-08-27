// @vitest-environment jsdom
/**
 * Locks the wire-shape contract for `hypermedia.ts`: type guards, link
 * resolution semantics, the `Conduit` accessor's not-installed failure mode,
 * and the conduit a test installs. `LiveConduit`-against-real-RPC is
 * exercised by the component integration tests; this covers the pure-logic
 * and in-memory surface so regressions in the contract fail immediately and
 * unambiguously.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { hasLink, getLink, conduit, setConduit, resetConduit, type TRepresentation, LiveConduit, ServerUnreachable, isServerUnreachable, serverLastRespondedAt } from "./hypermedia.js";
import { TestConduit } from "./test-setup.js";

beforeEach(() => {
	resetConduit();
});

describe("hasLink", () => {
	const rep: TRepresentation = {
		_type: "Email",
		_links: {
			trace: { method: "TraceExplorerStepper-getTrace", params: { seqPath: "0.1.2.3" } },
			malformed: { params: { x: 1 } } as unknown as { method: string },
		},
	};

	it("is true for a well-formed rel entry", () => {
		expect(hasLink(rep, "trace")).toBe(true);
	});

	it("is false for an unknown rel", () => {
		expect(hasLink(rep, "nonexistent")).toBe(false);
	});

	it("is false for a malformed link entry (missing method)", () => {
		expect(hasLink(rep, "malformed")).toBe(false);
	});

	it("is false when the Representation has no _links", () => {
		expect(hasLink({ _type: "Email" }, "trace")).toBe(false);
	});
});

describe("getLink", () => {
	const rep: TRepresentation = {
		_type: "Email",
		_links: { trace: { method: "TraceExplorerStepper-getTrace", params: { seqPath: "0.1.2.3" } } },
	};

	it("returns the link entry by rel name", () => {
		const link = getLink(rep, "trace");
		expect(link.method).toBe("TraceExplorerStepper-getTrace");
		expect(link.params).toEqual({ seqPath: "0.1.2.3" });
	});

	it("throws with a precise message when the rel isn't in _links — listing the rels that are", () => {
		expect(() => getLink(rep, "unknown-rel")).toThrow(/rel not in _links \(have: trace\)/);
	});

	it("throws with `<none>` when _links is absent so the diagnostic doesn't lie about availability", () => {
		expect(() => getLink({ _type: "Email" }, "trace")).toThrow(/Representation has no _links/);
	});

	it("throws on malformed link entries (missing method) — callers never get a half-formed link", () => {
		const bad: TRepresentation = { _links: { x: { params: {} } as unknown as { method: string } } };
		expect(() => getLink(bad, "x")).toThrow(/rel not in _links/);
	});
});

describe("conduit accessor", () => {
	it("throws with a precise message when no Conduit has been installed", () => {
		expect(() => conduit()).toThrow(/no Conduit installed/);
	});

	it("returns the installed instance after setConduit", () => {
		const c = new TestConduit(() => ({ _type: "Email" }));
		setConduit(c);
		expect(conduit()).toBe(c);
	});

	it("resetConduit returns to the not-installed state", () => {
		setConduit(new TestConduit(() => ({})));
		resetConduit();
		expect(() => conduit()).toThrow(/no Conduit installed/);
	});
});

describe("the conduit a test installs, answering from its own function", () => {
	it("returns the dispatched result for a known method", async () => {
		const c = new TestConduit((method) => {
			if (method === "Q-getOne") return { _type: "Email", subject: "hello" };
			throw new Error(`unmocked method: ${method}`);
		});
		const rep = await c.follow<TRepresentation>({ method: "Q-getOne" }, "test");
		expect(rep._type).toBe("Email");
		expect(rep.subject).toBe("hello");
	});

	it("surfaces the dispatch throw verbatim — no swallowing — naming the unmocked method", async () => {
		const c = new TestConduit(() => {
			throw new Error("unmocked method: NotConfigured-getThing");
		});
		await expect(c.follow({ method: "NotConfigured-getThing" }, "test")).rejects.toThrow(/unmocked method: NotConfigured-getThing/);
	});

	it("passes link.params through to the dispatch function", async () => {
		const seen: Array<{ method: string; params: Record<string, unknown> }> = [];
		const c = new TestConduit((method, params) => {
			seen.push({ method, params });
			return { ok: true };
		});
		await c.follow({ method: "X", params: { a: 1, b: "two" } }, "test");
		expect(seen).toEqual([{ method: "X", params: { a: 1, b: "two" } }]);
	});

	it("group passes the same instance as `g` — composed follows still serve from the same dispatch", async () => {
		const c = new TestConduit((method) => ({ _type: method }));
		const reps = await c.group("test-group", async (g) => {
			const a = await g.follow<TRepresentation>({ method: "A" }, "a");
			const b = await g.follow<TRepresentation>({ method: "B" }, "b");
			return [a, b];
		});
		expect(reps.map((r) => r._type)).toEqual(["A", "B"]);
	});
});

describe("the conduit a test installs, streaming from its own function", () => {
	it("calls onStart once before chunks arrive, then onChunk per emitted chunk for array results", async () => {
		const events: string[] = [];
		const c = new TestConduit(() => [{ text: "hello " }, { text: "world" }, { status: "done" }]);
		const { seqPath } = await c.followStream(
			{ method: "X-stream" },
			(chunk) => {
				events.push(JSON.stringify(chunk));
			},
			{
				why: "test",
				onStart: (sp) => {
					events.unshift(`start:${sp.join(".")}`);
				},
			},
		);
		expect(seqPath).toEqual([0]);
		expect(events).toEqual(["start:0", '{"text":"hello "}', '{"text":"world"}', '{"status":"done"}']);
	});

	it("emits a single chunk for non-array dispatch results", async () => {
		const chunks: unknown[] = [];
		const c = new TestConduit(() => ({ text: "only one" }));
		await c.followStream({ method: "X-stream" }, (c) => chunks.push(c), { why: "test" });
		expect(chunks).toEqual([{ text: "only one" }]);
	});
});

describe("a server that does not respond", () => {
	// A request that never gets a response says nothing about what it asked: the page reports it and reads what it caches.
	// Every other failure, including an error the server itself returns, stays a fault to fail on.
	it("raises ServerUnreachable when the request cannot be made, and isServerUnreachable finds it through a chain of causes", async () => {
		const fetchWas = globalThis.fetch;
		globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
		try {
			const conduit = new LiveConduit("");
			const err = await conduit.follow({ method: "step.list" }, "test").then(() => undefined, (e: unknown) => e);
			expect(err).toBeInstanceOf(ServerUnreachable);
			expect(isServerUnreachable(err)).toBe(true);
			expect(isServerUnreachable(new Error("wrapped", { cause: err }))).toBe(true);
			expect(String((err as Error).message)).toContain("/rpc/action.begin");
		} finally {
			globalThis.fetch = fetchWas;
		}
	});

	it("records when the server last responded, and records nothing when it never did", async () => {
		const fetchWas = globalThis.fetch;
		delete (globalThis as unknown as Record<string, unknown>)["__SHU_SERVER_RESPONDED__"];
		globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
		try {
			await new LiveConduit("").follow({ method: "step.list" }, "test").catch(() => undefined);
			expect(serverLastRespondedAt(), "a page that has reached no server holds no such time").toBeUndefined();
			// An error the server returns is still the server responding: what a reader is told is that it was reached.
			globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ error: "no such step" }), { status: 422, headers: { "Content-Type": "application/json" } }));
			const before = Date.now();
			await new LiveConduit("").follow({ method: "step.list" }, "test").catch(() => undefined);
			expect(serverLastRespondedAt() ?? 0).toBeGreaterThanOrEqual(before);
		} finally {
			globalThis.fetch = fetchWas;
			delete (globalThis as unknown as Record<string, unknown>)["__SHU_SERVER_RESPONDED__"];
		}
	});

	it("an error the server returns is not unreachability", async () => {
		const fetchWas = globalThis.fetch;
		globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ error: "no such step" }), { status: 422, headers: { "Content-Type": "application/json" } }));
		try {
			const err = await new LiveConduit("").follow({ method: "step.list" }, "test").then(() => undefined, (e: unknown) => e);
			expect(isServerUnreachable(err)).toBe(false);
		} finally {
			globalThis.fetch = fetchWas;
		}
	});
});
