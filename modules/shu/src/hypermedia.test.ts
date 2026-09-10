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

/** The page's own hydration, as a deployment serves it. */
function setHydration(payload: unknown): void {
	document.head.innerHTML = "";
	const script = document.createElement("script");
	script.type = "application/json";
	script.id = "shu-hydration";
	script.textContent = JSON.stringify(payload);
	document.head.appendChild(script);
}

import { hydrateFromDom } from "./rpc-registry.js";

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

describe("a server that does not respond", () => {
	// Whether the site has answered, and whether it was found silent, is what a page holds about it: each case states
	// the situation it is about, from a page that holds neither.
	beforeEach(() => {
		delete (globalThis as unknown as Record<string, unknown>)["__SHU_SERVER_RESPONDED__"];
		document.head.innerHTML = "";
	});

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
			// A page that has just found the site silent reads what it holds instead of calling again, and this is about
			// the call after that span rather than within it.
			delete (globalThis as unknown as Record<string, unknown>)["__SHU_SERVER_RESPONDED__"];
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

	it("reports a server that accepts a request without responding as unreachable, at the timeout", async () => {
		// The failure this bounds: a call neither answered nor refused left the view that made it reading nothing, with
		// no word of why, so the reading never fell back to what the device holds.
		const fetchWas = globalThis.fetch;
		setHydration({ settings: { responseTimeoutMs: 40 } });
		hydrateFromDom();
		let taken = 0;
		globalThis.fetch = ((_url: string, init?: { signal?: AbortSignal }) => {
			taken += 1;
			// Taken and left, as a site that has stopped answering leaves it: it settles only when the bound aborts it.
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			const began = Date.now();
			const err = await new LiveConduit("").follow({ method: "step.list" }, "test").then(() => undefined, (e: unknown) => e);
			expect(taken, "the call was made").toBeGreaterThan(0);
			expect(err, "and reported as the site not answering, which is what a reading falls back on").toBeInstanceOf(ServerUnreachable);
			expect(Date.now() - began, "within the bound the deployment set, rather than never").toBeLessThan(4000);
		} finally {
			globalThis.fetch = fetchWas;
			document.head.innerHTML = "";
		}
	});

	it("applies the timeout to a request the page awaits and none to a stream, which stays open while the run writes to it", async () => {
		const fetchWas = globalThis.fetch;
		setHydration({ settings: { responseTimeoutMs: 30 } });
		hydrateFromDom();
		const bounds: Array<boolean> = [];
		globalThis.fetch = ((url: string, init?: { signal?: AbortSignal; body?: string }) => {
			if (String(url).endsWith("/rpc/action.begin")) return Promise.resolve(new Response(JSON.stringify({ seqPath: [0, 1] }), { status: 200, headers: { "Content-Type": "application/json" } }));
			bounds.push(init?.signal !== undefined);
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			await new LiveConduit("").follow({ method: "step.list" }, "a read the page waits on").catch(() => undefined);
			expect(bounds.at(-1), "a read the page waits on carries a bound").toBe(true);
			// The call that opens an action is a call like any other, so this is about a page that has not just found the
			// site silent.
			delete (globalThis as unknown as Record<string, unknown>)["__SHU_SERVER_RESPONDED__"];
			const streaming = new LiveConduit("").followStream({ method: "step.list" }, () => undefined, { why: "the run's own stream" }).catch(() => undefined);
			await new Promise((r) => setTimeout(r, 60));
			expect(bounds.at(-1), "and a stream carries none, so it is not closed under a run still writing to it").toBe(false);
			void streaming;
		} finally {
			globalThis.fetch = fetchWas;
			document.head.innerHTML = "";
		}
	});

	it("issues one request per retry interval, not one per read, so concurrent reads fall back instead of each timing out", async () => {
		const fetchWas = globalThis.fetch;
		setHydration({ settings: { responseTimeoutMs: 60 } });
		hydrateFromDom();
		delete (globalThis as unknown as Record<string, unknown>)["__SHU_SERVER_RESPONDED__"];
		let made = 0;
		globalThis.fetch = ((_url: string, init?: { signal?: AbortSignal }) => {
			made += 1;
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			const conduit = new LiveConduit("");
			await conduit.follow({ method: "step.list" }, "the first read").catch(() => undefined);
			const afterFirst = made;
			const began = Date.now();
			await Promise.all(Array.from({ length: 8 }, () => conduit.follow({ method: "step.list" }, "a view reading").catch(() => undefined)));
			expect(made, "the reads that followed took the answer the first one got").toBe(afterFirst);
			expect(Date.now() - began, "so none of them waited the bound out again").toBeLessThan(60);
		} finally {
			globalThis.fetch = fetchWas;
			delete (globalThis as unknown as Record<string, unknown>)["__SHU_SERVER_RESPONDED__"];
			document.head.innerHTML = "";
		}
	});

	it("issues a request again after the retry interval, so a server that recovers is detected", async () => {
		const fetchWas = globalThis.fetch;
		delete (globalThis as unknown as Record<string, unknown>)["__SHU_SERVER_RESPONDED__"];
		setHydration({ settings: { responseTimeoutMs: 40 } });
		hydrateFromDom();
		let made = 0;
		// A site that takes the call and never answers it, which is what the page remembers as silent.
		globalThis.fetch = ((_url: string, init?: { signal?: AbortSignal }) => {
			made += 1;
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			const conduit = new LiveConduit("");
			await conduit.follow({ method: "step.list" }, "the first read").catch(() => undefined);
			expect(made).toBe(1);
			await conduit.follow({ method: "step.list" }, "a read within the span").catch(() => undefined);
			expect(made, "within the span, the answer the first call got stands").toBe(1);
			(globalThis as unknown as Record<string, { unreachableUntil: number }>)["__SHU_SERVER_RESPONDED__"].unreachableUntil = Date.now() - 1;
			await conduit.follow({ method: "step.list" }, "a read after it").catch(() => undefined);
			expect(made, "and after it the site is called again").toBe(2);
		} finally {
			globalThis.fetch = fetchWas;
			delete (globalThis as unknown as Record<string, unknown>)["__SHU_SERVER_RESPONDED__"];
			document.head.innerHTML = "";
		}
	});

	it("issues a request again immediately after one the network refused, since that failure costs no waiting", async () => {
		const fetchWas = globalThis.fetch;
		let made = 0;
		globalThis.fetch = (() => {
			made += 1;
			return Promise.reject(new TypeError("Failed to fetch"));
		}) as unknown as typeof globalThis.fetch;
		try {
			const conduit = new LiveConduit("");
			await conduit.follow({ method: "step.list" }, "the first read").catch(() => undefined);
			await conduit.follow({ method: "step.list" }, "the read after it").catch(() => undefined);
			expect(made, "each read asked, since the answer came back at once").toBeGreaterThan(1);
		} finally {
			globalThis.fetch = fetchWas;
			delete (globalThis as unknown as Record<string, unknown>)["__SHU_SERVER_RESPONDED__"];
		}
	});

	it("reports a request the caller aborted as the caller's, not as an unreachable server", async () => {
		const fetchWas = globalThis.fetch;
		setHydration({ settings: {} });
		hydrateFromDom();
		globalThis.fetch = ((url: string, init?: { signal?: AbortSignal }) => {
			// The site answers the call that opens an action, and takes the streamed read without answering it, so what
			// settles that read is the reader stopping it.
			if (String(url).endsWith("/rpc/action.begin")) return Promise.resolve(new Response(JSON.stringify({ seqPath: [0, 1] }), { status: 200, headers: { "Content-Type": "application/json" } }));
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			const stopping = new AbortController();
			const following = new LiveConduit("").followStream({ method: "step.list" }, () => undefined, { why: "a reader reading", signal: stopping.signal }).then(() => undefined, (e: unknown) => e);
			await new Promise((r) => setTimeout(r, 5));
			stopping.abort();
			const err = await following;
			expect(err, "a reader who stopped reading says nothing about whether the site answers").not.toBeInstanceOf(ServerUnreachable);
		} finally {
			globalThis.fetch = fetchWas;
			document.head.innerHTML = "";
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
