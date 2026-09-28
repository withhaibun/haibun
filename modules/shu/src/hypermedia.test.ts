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
import {
	reads,
	acts,
	type TLink,
	hasLink,
	getLink,
	conduit,
	setConduit,
	type TRepresentation,
	LiveConduit,
	ServerUnreachable,
	isServerUnreachable,
	serverLastRespondedAt,
} from "./hypermedia.js";
import { TestConduit } from "./test-setup.js";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";

beforeEach(() => {
	endPage();
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
import { rpcAnswer } from "@haibun/core/lib/test/rpc-answer.js";
import { endPage, pagePinned } from "./page-pinned.js";

/** The copy of this module another bundle on the page loads. */
const BUNDLE_COPY = "./hypermedia.js?bundle=graph-view";

describe("what a link asks of a run", () => {
	// A page cannot read a run through a step whose answer the run would record, and cannot forget to say which it
	// wants: a link carries what it asks, so the two constructors are the only ways to make one. A bare object is not a
	// link, which the compiler states rather than a run discovering it while a page follows.
	it("states reading, and states acting, and cannot be made without stating one", () => {
		expect(reads("SomeStepper-showThings")).toEqual({ method: "SomeStepper-showThings", params: undefined, summary: undefined, asks: "read" });
		expect(acts("SomeStepper-doThing", { id: "a" })).toMatchObject({ method: "SomeStepper-doThing", params: { id: "a" }, asks: "act" });
		// @ts-expect-error a bare method is not a link: it doesn't say what it asks of the run
		const unstated: TLink = { method: "SomeStepper-showThings" };
		expect(unstated.asks).toBeUndefined();
	});
});

describe("hasLink", () => {
	const rep: TRepresentation = {
		_type: "Email",
		_links: {
			trace: reads("TraceExplorerStepper-getTrace", { seqPath: "0.1.2.3" }),
			malformed: { params: { x: 1 } } as unknown as TLink,
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

	it("is false when the Representation doesn't have _links", () => {
		expect(hasLink({ _type: "Email" }, "trace")).toBe(false);
	});
});

describe("getLink", () => {
	const rep: TRepresentation = {
		_type: "Email",
		_links: { trace: reads("TraceExplorerStepper-getTrace", { seqPath: "0.1.2.3" }) },
	};

	it("returns the link entry by rel name", () => {
		const link = getLink(rep, "trace");
		expect(link.method).toBe("TraceExplorerStepper-getTrace");
		expect(link.params).toEqual({ seqPath: "0.1.2.3" });
	});

	it("throws with a precise message when the rel isn't in _links, listing the rels that are", () => {
		expect(() => getLink(rep, "unknown-rel")).toThrow(/rel not in _links \(have: trace\)/);
	});

	it("throws with `<none>` when _links is absent so the diagnostic doesn't lie about availability", () => {
		expect(() => getLink({ _type: "Email" }, "trace")).toThrow(/Representation has no _links/);
	});

	it("throws on malformed link entries (missing method), callers never get a half-formed link", () => {
		const bad: TRepresentation = { _links: { x: { params: {} } as unknown as TLink } };
		expect(() => getLink(bad, "x")).toThrow(/rel not in _links/);
	});
});

describe("conduit accessor", () => {
	it("throws with a precise message when a Conduit hasn't been installed", () => {
		expect(() => conduit()).toThrow(/a Conduit isn't installed/);
	});

	it("returns the installed instance after setConduit", () => {
		const c = new TestConduit(() => ({ _type: "Email" }));
		setConduit(c);
		expect(conduit()).toBe(c);
	});

	it("a page that has ended doesn't have a conduit installed", () => {
		setConduit(new TestConduit(() => ({})));
		endPage();
		expect(() => conduit()).toThrow(/a Conduit isn't installed/);
	});
});

describe("a server that does not respond", () => {
	// Whether the site has answered, and whether it was found silent, is what a page holds about it: each case states
	// the situation it is about, from a page that doesn't hold either.
	beforeEach(() => {
		endPage();
		document.head.innerHTML = "";
	});

	// A request that never gets a response doesn't indicate a fault in what it asked: the page reports it and reads what it caches.
	// Every other failure, including an error the server itself returns, stays a fault to fail on.
	it("raises ServerUnreachable when the request cannot be made, and isServerUnreachable finds it through a chain of causes", async () => {
		const fetchWas = globalThis.fetch;
		globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
		try {
			const conduit = new LiveConduit("");
			const err = await conduit.follow(acts(SHOW_STEPS_METHOD), "test").then(
				() => undefined,
				(e: unknown) => e,
			);
			expect(err).toBeInstanceOf(ServerUnreachable);
			expect(isServerUnreachable(err)).toBe(true);
			expect(isServerUnreachable(new Error("wrapped", { cause: err }))).toBe(true);
			expect(String((err as Error).message)).toContain("/rpc/action.begin");
		} finally {
			globalThis.fetch = fetchWas;
		}
	});

	it("finds the server not responding in a failure another bundle's copy of the conduit raised", async () => {
		// A second bundle loads its own copy of this module, so its conduit fails with its own ServerUnreachable class.
		const otherBundle: typeof import("./hypermedia.js") = await import(/* @vite-ignore */ BUNDLE_COPY);
		expect(otherBundle.ServerUnreachable).not.toBe(ServerUnreachable);
		expect(isServerUnreachable(new Error("wrapped", { cause: new otherBundle.ServerUnreachable("/rpc/action.begin", new TypeError("Failed to fetch")) }))).toBe(true);
		expect(isServerUnreachable(new Error("refused"))).toBe(false);
	});

	it("fails a call a path the server does not serve answered as text, with the status and what it sent, and reads a refusal the run states", async () => {
		const fetchWas = globalThis.fetch;
		try {
			globalThis.fetch = () => Promise.resolve(new Response("404 Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=UTF-8" } }));
			await expect(new LiveConduit("").follow(reads(SHOW_STEPS_METHOD), "test")).rejects.toThrow(
				`${SHOW_STEPS_METHOD}: the server answered 404 with text/plain; charset=UTF-8, not the run's JSON: 404 Not Found`,
			);
			globalThis.fetch = () => Promise.resolve(rpcAnswer({ ok: false, error: "no such step" }, 422));
			await expect(new LiveConduit("").follow(reads(SHOW_STEPS_METHOD), "test")).rejects.toThrow("no such step");
		} finally {
			globalThis.fetch = fetchWas;
		}
	});

	it("records when the server last responded, and doesn't record a time when it never did", async () => {
		const fetchWas = globalThis.fetch;
		endPage();
		globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
		try {
			await new LiveConduit("").follow(acts(SHOW_STEPS_METHOD), "test").catch(() => undefined);
			expect(serverLastRespondedAt(), "a page that hasn't reached a server doesn't hold such a time").toBeUndefined();
			// A page that has just found the site silent reads what it holds instead of calling again, and this is about
			// the call after that span rather than within it.
			endPage();
			// An error the server returns is still the server responding: what a reader is told is that it was reached.
			globalThis.fetch = () => Promise.resolve(rpcAnswer({ error: "no such step" }, 422));
			const before = Date.now();
			await new LiveConduit("").follow(acts(SHOW_STEPS_METHOD), "test").catch(() => undefined);
			expect(serverLastRespondedAt() ?? 0).toBeGreaterThanOrEqual(before);
		} finally {
			globalThis.fetch = fetchWas;
			endPage();
		}
	});

	it("reports a server that accepts a request without responding as unreachable, at the timeout", async () => {
		// The failure this bounds: a call that wasn't answered or refused left the view that made it empty, and the view didn't
		// state why, so the reading never fell back to what the device holds.
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
			const err = await new LiveConduit("").follow(acts(SHOW_STEPS_METHOD), "test").then(
				() => undefined,
				(e: unknown) => e,
			);
			expect(taken, "the call was made").toBeGreaterThan(0);
			expect(err, "and reported as the site not answering, which is what a reading falls back on").toBeInstanceOf(ServerUnreachable);
			expect(Date.now() - began, "within the bound the deployment set, rather than never").toBeLessThan(4000);
		} finally {
			globalThis.fetch = fetchWas;
			document.head.innerHTML = "";
		}
	});

	it("applies the timeout to a request the page awaits and doesn't apply one to a stream, which stays open while the run writes to it", async () => {
		const fetchWas = globalThis.fetch;
		setHydration({ settings: { responseTimeoutMs: 30 } });
		hydrateFromDom();
		const bounds: Array<boolean> = [];
		globalThis.fetch = ((url: string, init?: { signal?: AbortSignal; body?: string }) => {
			if (String(url).endsWith("/rpc/action.begin")) return Promise.resolve(rpcAnswer({ seqPath: [0, 1] }, 200));
			bounds.push(init?.signal !== undefined);
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			await new LiveConduit("").follow(acts(SHOW_STEPS_METHOD), "a read the page waits on").catch(() => undefined);
			expect(bounds.at(-1), "a read the page waits on carries a bound").toBe(true);
			// The call that opens an action is a call like any other, so this is about a page that has not just found the
			// site silent.
			endPage();
			const streaming = new LiveConduit("").followStream(acts(SHOW_STEPS_METHOD), () => undefined, { why: "the run's own stream" }).catch(() => undefined);
			await new Promise((r) => setTimeout(r, 60));
			expect(bounds.at(-1), "and a stream doesn't carry one, so it is not closed under a run still writing to it").toBe(false);
			void streaming;
		} finally {
			globalThis.fetch = fetchWas;
			document.head.innerHTML = "";
		}
	});

	it("issues one request per retry interval, not one per read, so concurrent reads fall back instead of each timing out", async () => {
		const fetchWas = globalThis.fetch;
		endPage();
		setHydration({ settings: { responseTimeoutMs: 60 } });
		hydrateFromDom();
		let made = 0;
		globalThis.fetch = ((_url: string, init?: { signal?: AbortSignal }) => {
			made += 1;
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			const conduit = new LiveConduit("");
			await conduit.follow(reads(SHOW_STEPS_METHOD), "the first read").catch(() => undefined);
			const afterFirst = made;
			const began = Date.now();
			await Promise.all(Array.from({ length: 8 }, () => conduit.follow(reads(SHOW_STEPS_METHOD), "a view reading").catch(() => undefined)));
			expect(made, "the reads that followed took the answer the first one got").toBe(afterFirst);
			expect(Date.now() - began, "so they didn't wait the bound out again").toBeLessThan(60);
		} finally {
			globalThis.fetch = fetchWas;
			endPage();
			document.head.innerHTML = "";
		}
	});

	it("issues a request again after the retry interval, so a server that recovers is detected", async () => {
		const fetchWas = globalThis.fetch;
		endPage();
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
			await conduit.follow(reads(SHOW_STEPS_METHOD), "the first read").catch(() => undefined);
			expect(made).toBe(1);
			await conduit.follow(reads(SHOW_STEPS_METHOD), "a read within the span").catch(() => undefined);
			expect(made, "within the span, the answer the first call got stands").toBe(1);
			pagePinned<{ unreachableUntil: number }>("__SHU_SERVER_RESPONDED__", () => ({ unreachableUntil: 0 })).unreachableUntil = Date.now() - 1;
			await conduit.follow(reads(SHOW_STEPS_METHOD), "a read after it").catch(() => undefined);
			expect(made, "and after it the site is called again").toBe(2);
		} finally {
			globalThis.fetch = fetchWas;
			endPage();
			document.head.innerHTML = "";
		}
	});

	it("issues an act within that span, since a reader asked for it and a read's timeout is not its answer", async () => {
		// The failure this bounds: a question typed into the ask pane wasn't sent because a view's read had timed out a
		// moment earlier, so the page refused to carry what the reader asked for.
		const fetchWas = globalThis.fetch;
		endPage();
		setHydration({ settings: { responseTimeoutMs: 40 } });
		hydrateFromDom();
		const asked: string[] = [];
		globalThis.fetch = ((url: string, init?: { signal?: AbortSignal }) => {
			asked.push(new URL(String(url)).pathname);
			if (String(url).endsWith("/rpc/action.begin")) return Promise.resolve(rpcAnswer({ seqPath: [0, 1] }, 200));
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			const conduit = new LiveConduit("");
			await conduit.follow(reads(SHOW_STEPS_METHOD), "a view reading").catch(() => undefined);
			const afterRead = asked.length;
			await conduit.follow(acts("chatWithContext"), "what the reader asked for").catch(() => undefined);
			expect(asked.slice(afterRead), "the act was carried to the server, beginning with its place in the run").toContain("/rpc/action.begin");
			expect(asked.slice(afterRead), "and then the act itself").toContain("/rpc/chatWithContext");
		} finally {
			globalThis.fetch = fetchWas;
			endPage();
			document.head.innerHTML = "";
		}
	});

	it("issues a request again immediately after one the network refused, since that failure doesn't need a wait", async () => {
		const fetchWas = globalThis.fetch;
		let made = 0;
		globalThis.fetch = (() => {
			made += 1;
			return Promise.reject(new TypeError("Failed to fetch"));
		}) as unknown as typeof globalThis.fetch;
		try {
			const conduit = new LiveConduit("");
			await conduit.follow(acts(SHOW_STEPS_METHOD), "the first read").catch(() => undefined);
			await conduit.follow(acts(SHOW_STEPS_METHOD), "the read after it").catch(() => undefined);
			expect(made, "each read asked, since the answer came back at once").toBeGreaterThan(1);
		} finally {
			globalThis.fetch = fetchWas;
			endPage();
		}
	});

	it("reports a request the caller aborted as the caller's, not as an unreachable server", async () => {
		const fetchWas = globalThis.fetch;
		setHydration({ settings: {} });
		hydrateFromDom();
		globalThis.fetch = ((url: string, init?: { signal?: AbortSignal }) => {
			// The site answers the call that opens an action, and takes the streamed read without answering it, so what
			// settles that read is the reader stopping it.
			if (String(url).endsWith("/rpc/action.begin")) return Promise.resolve(rpcAnswer({ seqPath: [0, 1] }, 200));
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			const stopping = new AbortController();
			const following = new LiveConduit("")
				.followStream(acts(SHOW_STEPS_METHOD), () => undefined, { why: "a reader reading", signal: stopping.signal })
				.then(
					() => undefined,
					(e: unknown) => e,
				);
			await new Promise((r) => setTimeout(r, 5));
			stopping.abort();
			const err = await following;
			expect(err, "a reader who stopped reading doesn't show whether the site answers").not.toBeInstanceOf(ServerUnreachable);
		} finally {
			globalThis.fetch = fetchWas;
			document.head.innerHTML = "";
		}
	});

	it("an error the server returns is not unreachability", async () => {
		const fetchWas = globalThis.fetch;
		globalThis.fetch = () => Promise.resolve(rpcAnswer({ error: "no such step" }, 422));
		try {
			const err = await new LiveConduit("").follow(acts(SHOW_STEPS_METHOD), "test").then(
				() => undefined,
				(e: unknown) => e,
			);
			expect(isServerUnreachable(err)).toBe(false);
		} finally {
			globalThis.fetch = fetchWas;
		}
	});
});
