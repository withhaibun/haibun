// @vitest-environment jsdom
/**
 * Locks the wire-shape contract for `hypermedia.ts`: type guards, link
 * resolution semantics, the `Conduit` accessor's not-installed failure mode,
 * and `SerializedConduit` behaviour. `LiveConduit`-against-real-RPC is
 * exercised by the component integration tests; this covers the pure-logic
 * and in-memory surface so regressions in the contract fail immediately and
 * unambiguously.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { hasLink, getLink, conduit, setConduit, resetConduit, SerializedConduit, type TRepresentation } from "./hypermedia.js";

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
		const c = new SerializedConduit(() => ({ _type: "Email" }));
		setConduit(c);
		expect(conduit()).toBe(c);
	});

	it("resetConduit returns to the not-installed state", () => {
		setConduit(new SerializedConduit(() => ({})));
		resetConduit();
		expect(() => conduit()).toThrow(/no Conduit installed/);
	});
});

describe("SerializedConduit.follow", () => {
	it("returns the dispatched result for a known method", async () => {
		const c = new SerializedConduit((method) => {
			if (method === "Q-getOne") return { _type: "Email", subject: "hello" };
			throw new Error(`unmocked method: ${method}`);
		});
		const rep = await c.follow<TRepresentation>({ method: "Q-getOne" }, "test");
		expect(rep._type).toBe("Email");
		expect(rep.subject).toBe("hello");
	});

	it("surfaces the dispatch throw verbatim — no swallowing — naming the unmocked method", async () => {
		const c = new SerializedConduit(() => {
			throw new Error("unmocked method: NotConfigured-getThing");
		});
		await expect(c.follow({ method: "NotConfigured-getThing" }, "test")).rejects.toThrow(/unmocked method: NotConfigured-getThing/);
	});

	it("passes link.params through to the dispatch function", async () => {
		const seen: Array<{ method: string; params: Record<string, unknown> }> = [];
		const c = new SerializedConduit((method, params) => {
			seen.push({ method, params });
			return { ok: true };
		});
		await c.follow({ method: "X", params: { a: 1, b: "two" } }, "test");
		expect(seen).toEqual([{ method: "X", params: { a: 1, b: "two" } }]);
	});

	it("group passes the same instance as `g` — composed follows still serve from the same dispatch", async () => {
		const c = new SerializedConduit((method) => ({ _type: method }));
		const reps = await c.group("test-group", async (g) => {
			const a = await g.follow<TRepresentation>({ method: "A" }, "a");
			const b = await g.follow<TRepresentation>({ method: "B" }, "b");
			return [a, b];
		});
		expect(reps.map((r) => r._type)).toEqual(["A", "B"]);
	});
});

describe("SerializedConduit.followStream", () => {
	it("calls onStart once before chunks arrive, then onChunk per emitted chunk for array results", async () => {
		const events: string[] = [];
		const c = new SerializedConduit(() => [{ text: "hello " }, { text: "world" }, { status: "done" }]);
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
		const c = new SerializedConduit(() => ({ text: "only one" }));
		await c.followStream({ method: "X-stream" }, (c) => chunks.push(c), { why: "test" });
		expect(chunks).toEqual([{ text: "only one" }]);
	});
});
