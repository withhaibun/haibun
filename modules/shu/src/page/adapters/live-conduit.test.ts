// @vitest-environment jsdom
/**
 * Tests the wire-shape contract of `hypermedia.ts`: the type guards, link resolution, the `TConduit` accessor's failure
 * where a conduit isn't installed, and the conduit a test installs. It also tests `LiveConduit` against a replaced
 * `fetch`: a server that doesn't respond, the timeout, the retry interval and refusals. A regression in the contract
 * fails in this file. The component integration tests exercise `LiveConduit` against a running RPC service.
 */
import { requiredActionOf } from "../controllers/registry-controller.js";
import "fake-indexeddb/auto";
import { authorityRefusal, notFromActuality, REFUSED_INVOCATION } from "@haibun/core/lib/rpc-wire.js";
import { openPageAuthority, pageMay } from "../authority/controllers/page-authority-controller.js";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { reads, acts, type TLink, type TRepresentation } from "../domains/links.js";
import { hasLink, getLink } from "../derivations/links.js";
import { conduit, serverLastRespondedAt } from "../controllers/conduit-controller.js";
import { installConduit, installServedConduit } from "../root.js";
import { ServerUnreachable, isServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import { PAGE_ACTUALITY, SERVED_SETTINGS, TestConduit, hydrate, servedWith, serveThePage, newPage } from "../../test/setup.js";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";

beforeEach(() => {
	newPage();
});

/** Sets the page's own hydration, as a deployment serves it. */
function setHydration(payload: Record<string, unknown>): void {
	document.head.innerHTML = "";
	hydrate({ actualityId: PAGE_ACTUALITY, ...payload });
}

import { hydrateFromDom } from "../controllers/hydration-controller.js";
import { rpcAnswer, HANDSHAKE_PATH } from "@haibun/core/lib/test/rpc-answer.js";
import { UNREACHABLE_RETRY_AFTER_MS } from "./live-conduit.js";

/** The specifier of the copy of hypermedia.js that another bundle on the page loads. */
const BUNDLE_COPY = "@haibun/core/lib/rpc-wire.js?bundle=graph-view";

describe("whether a link reads or acts", () => {
	// A page can't read actuality through a step whose result actuality would record. Each link's required `asks` field
	// states whether the link reads or acts, so the constructors `reads` and `acts` are the only ways to make a link. The
	// compiler rejects a bare object as a link, so the error appears at build time instead of while a page follows it.
	it("states reading or acting, and can't be made without stating one", () => {
		expect(reads("SomeStepper-showThings")).toEqual({ method: "SomeStepper-showThings", params: undefined, summary: undefined, asks: "read" });
		expect(acts("SomeStepper-doThing", { id: "a" })).toMatchObject({ method: "SomeStepper-doThing", params: { id: "a" }, asks: "act" });
		// @ts-expect-error a bare method isn't a link, because it doesn't state whether it reads or acts
		const unstated: TLink = { method: "SomeStepper-showThings" };
		expect(unstated.asks).toBeUndefined();
	});
});

describe("hasLink", () => {
	const rep: TRepresentation = {
		_type: "Email",
		_links: { trace: reads("TraceExplorerStepper-getTrace", { seqPath: "0.1.2.3" }), malformed: { params: { x: 1 } } as unknown as TLink },
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
	const rep: TRepresentation = { _type: "Email", _links: { trace: reads("TraceExplorerStepper-getTrace", { seqPath: "0.1.2.3" }) } };

	it("returns the link entry by rel name", () => {
		const link = getLink(rep, "trace");
		expect(link.method).toBe("TraceExplorerStepper-getTrace");
		expect(link.params).toEqual({ seqPath: "0.1.2.3" });
	});

	it("throws a message that lists the rels in _links when the requested rel isn't one of them", () => {
		expect(() => getLink(rep, "unknown-rel")).toThrow(/_links doesn't hold unknown-rel; it holds trace/);
	});

	it("throws where the representation doesn't hold _links", () => {
		expect(() => getLink({ _type: "Email" }, "trace")).toThrow(/representation doesn't hold _links/);
	});

	it("throws on a malformed link entry (missing method), so a caller never receives a partial link", () => {
		const bad: TRepresentation = { _links: { x: { params: {} } as unknown as TLink } };
		expect(() => getLink(bad, "x")).toThrow(/_links doesn't hold x/);
	});
});

describe("conduit accessor", () => {
	it("throws a message that names what installs a conduit where the page doesn't hold one", () => {
		expect(() => conduit()).toThrow(/the page doesn't hold a conduit/);
	});

	it("returns the installed instance after setConduit", () => {
		const c = new TestConduit(() => ({ _type: "Email" }));
		installConduit(c);
		expect(conduit()).toBe(c);
	});

	it("a page that has ended doesn't have a conduit installed", () => {
		installConduit(new TestConduit(() => ({})));
		newPage();
		expect(() => conduit()).toThrow(/the page doesn't hold a conduit/);
	});
});

describe("a server that does not respond", () => {
	// A page holds when the site last responded and whether a timeout marked the site unreachable. Each case starts from
	// a page that doesn't hold either, and sets up its own situation.
	beforeEach(() => {
		newPage();
		document.head.innerHTML = "";
		serveThePage();
	});

	// A request without a response doesn't indicate a fault in the request. The page reports the server as unreachable
	// and reads what the device holds. Every other failure, including an error the server returns, remains a fault.
	it("raises ServerUnreachable when the request cannot be made, and isServerUnreachable finds it through a chain of causes", async () => {
		const fetchWas = globalThis.fetch;
		globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
		try {
			const conduit = installServedConduit("", requiredActionOf);
			const err = await conduit.follow(acts(SHOW_STEPS_METHOD), "test").then(
				() => undefined,
				(e: unknown) => e,
			);
			expect(err).toBeInstanceOf(ServerUnreachable);
			expect(isServerUnreachable(err)).toBe(true);
			expect(isServerUnreachable(new Error("wrapped", { cause: err }))).toBe(true);
			expect(String((err as Error).message)).toContain(HANDSHAKE_PATH);
		} finally {
			globalThis.fetch = fetchWas;
		}
	});

	it("detects the server not responding in a failure from another bundle's copy of the conduit", async () => {
		// A second bundle loads its own copy of the wire module, so its conduit throws its own ServerUnreachable class.
		const otherBundle: typeof import("@haibun/core/lib/rpc-wire.js") = await import(/* @vite-ignore */ BUNDLE_COPY);
		expect(otherBundle.ServerUnreachable).not.toBe(ServerUnreachable);
		expect(isServerUnreachable(new Error("wrapped", { cause: new otherBundle.ServerUnreachable(HANDSHAKE_PATH, new TypeError("Failed to fetch")) }))).toBe(true);
		expect(isServerUnreachable(new Error("refused"))).toBe(false);
	});

	it("fails a call to a path the server doesn't serve with the server's status and text, and throws the error of a refusal actuality returns", async () => {
		const fetchWas = globalThis.fetch;
		try {
			globalThis.fetch = () => Promise.resolve(new Response("404 Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=UTF-8" } }));
			await expect(installServedConduit("", requiredActionOf).follow(reads(SHOW_STEPS_METHOD), "test")).rejects.toThrow(
				notFromActuality(SHOW_STEPS_METHOD, 404, "text/plain; charset=UTF-8", "404 Not Found").error,
			);
			globalThis.fetch = () => Promise.resolve(rpcAnswer({ ok: false, error: "no such step" }, 422));
			await expect(installServedConduit("", requiredActionOf).follow(reads(SHOW_STEPS_METHOD), "test")).rejects.toThrow("no such step");
		} finally {
			globalThis.fetch = fetchWas;
		}
	});

	it("releases the page's authority where actuality refuses it for failing verification, as for a revoked authority", async () => {
		const fetchWas = globalThis.fetch;
		const HELD = "Stepper:held";
		await openPageAuthority(undefined, [HELD]);
		try {
			globalThis.fetch = () => Promise.resolve(rpcAnswer(authorityRefusal("the presented authority failed verification: revoked"), REFUSED_INVOCATION));
			await expect(installServedConduit("", requiredActionOf).follow(reads(SHOW_STEPS_METHOD), "test")).rejects.toThrow("revoked");
			expect(pageMay(HELD), "the page doesn't hold the authority actuality refused").toBe(false);
		} finally {
			globalThis.fetch = fetchWas;
		}
	});

	it("records when the server last responded, and doesn't record a time where the server never responded", async () => {
		const fetchWas = globalThis.fetch;
		newPage();
		serveThePage();
		globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
		try {
			await expect(installServedConduit("", requiredActionOf).follow(acts(SHOW_STEPS_METHOD), "test")).rejects.toThrow();
			expect(serverLastRespondedAt(), "a page that hasn't reached a server doesn't hold such a time").toBeUndefined();
			// The second part starts a new page, so the state the first part left doesn't affect it.
			newPage();
			serveThePage();
			// An error the server returns still counts as a response, so a reader sees that the page reached the server.
			globalThis.fetch = () => Promise.resolve(rpcAnswer({ error: "no such step" }, 422));
			const before = Date.now();
			await expect(installServedConduit("", requiredActionOf).follow(acts(SHOW_STEPS_METHOD), "test")).rejects.toThrow();
			expect(serverLastRespondedAt() ?? 0).toBeGreaterThanOrEqual(before);
		} finally {
			globalThis.fetch = fetchWas;
			newPage();
		}
	});

	it("reports a server that accepts a request without responding as unreachable, at the timeout", async () => {
		// A call that doesn't receive a response or a refusal would leave the calling view empty without a reason, and the
		// reading wouldn't fall back to what the device holds. The timeout bounds that call.
		const fetchWas = globalThis.fetch;
		setHydration({ settings: servedWith({ responseTimeoutMs: 40 }) });
		hydrateFromDom();
		let taken = 0;
		globalThis.fetch = ((_url: string, init?: { signal?: AbortSignal }) => {
			taken += 1;
			// The fake accepts the call and doesn't respond, as a stopped site does. The promise settles only when the timeout
			// aborts it.
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			const began = Date.now();
			const err = await installServedConduit("", requiredActionOf)
				.follow(acts(SHOW_STEPS_METHOD), "test")
				.then(
					() => undefined,
					(e: unknown) => e,
				);
			expect(taken, "the call was made").toBeGreaterThan(0);
			expect(err, "and reported as the site not responding, so a reading falls back to what the device holds").toBeInstanceOf(ServerUnreachable);
			expect(Date.now() - began, "within the timeout the deployment set, instead of never").toBeLessThan(4000);
		} finally {
			globalThis.fetch = fetchWas;
			document.head.innerHTML = "";
		}
	});

	it("reports a server whose response stalls after its headers as unreachable, since the timeout bounds the whole response", async () => {
		// A timeout while the body arrives reports the server as not responding, as a timeout before the headers does. An
		// aborted request would otherwise reach the page as a fault.
		const fetchWas = globalThis.fetch;
		setHydration({ settings: servedWith({ responseTimeoutMs: 40 }) });
		hydrateFromDom();
		globalThis.fetch = ((_url: string, init?: { signal?: AbortSignal }) => {
			const stalled = new ReadableStream<Uint8Array>({
				start: (controller) => init?.signal?.addEventListener("abort", () => controller.error(new DOMException("The user aborted a request.", "AbortError")), { once: true }),
			});
			return Promise.resolve(new Response(stalled, { status: 200, headers: { "content-type": "application/json" } }));
		}) as unknown as typeof globalThis.fetch;
		try {
			const err = await installServedConduit("", requiredActionOf)
				.follow(acts(SHOW_STEPS_METHOD), "test")
				.then(
					() => undefined,
					(e: unknown) => e,
				);
			expect(err, "a stalled response reports the server as not responding").toBeInstanceOf(ServerUnreachable);
		} finally {
			globalThis.fetch = fetchWas;
			document.head.innerHTML = "";
		}
	});

	it("applies the timeout to a request the page awaits and doesn't apply one to a stream, which stays open while actuality writes to it", async () => {
		const fetchWas = globalThis.fetch;
		setHydration({ settings: servedWith({ responseTimeoutMs: 30 }) });
		hydrateFromDom();
		const bounds: Array<boolean> = [];
		globalThis.fetch = ((url: string, init?: { signal?: AbortSignal; body?: string }) => {
			if (String(url).endsWith(HANDSHAKE_PATH)) return Promise.resolve(rpcAnswer({ seqPath: [0, 1] }, 200));
			bounds.push(init?.signal !== undefined);
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			await expect(installServedConduit("", requiredActionOf).follow(acts(SHOW_STEPS_METHOD), "a read the page awaits")).rejects.toThrow();
			expect(bounds.at(-1), "a read the page awaits carries a timeout").toBe(true);
			// The call that opens an action carries a timeout like any other awaited call. This part starts a page that
			// hasn't found the site unreachable.
			newPage();
			serveThePage();
			const streaming = installServedConduit("", requiredActionOf)
				.followStream(acts(SHOW_STEPS_METHOD), () => undefined, { why: "actuality's own stream" })
				// The stream stays open until the test ends, and its end at teardown is the test's, not a failure it reads.
				.catch((endedAtTeardown: unknown) => endedAtTeardown);
			await new Promise((r) => setTimeout(r, 60));
			expect(bounds.at(-1), "and a stream doesn't carry one, so a timeout doesn't close it while actuality writes to it").toBe(false);
			void streaming;
		} finally {
			globalThis.fetch = fetchWas;
			document.head.innerHTML = "";
		}
	});

	it("issues one request per retry interval, not one per read, so concurrent reads fall back instead of each timing out", async () => {
		const fetchWas = globalThis.fetch;
		newPage();
		setHydration({ settings: servedWith({ responseTimeoutMs: 60 }) });
		hydrateFromDom();
		let made = 0;
		globalThis.fetch = ((_url: string, init?: { signal?: AbortSignal }) => {
			made += 1;
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			const conduit = installServedConduit("", requiredActionOf);
			await expect(conduit.follow(reads(SHOW_STEPS_METHOD), "the first read")).rejects.toThrow();
			const afterFirst = made;
			const began = Date.now();
			await Promise.all(Array.from({ length: 8 }, () => expect(conduit.follow(reads(SHOW_STEPS_METHOD), "a view reading")).rejects.toThrow()));
			expect(made, "the following reads didn't call fetch, since the first read's timeout stands for them").toBe(afterFirst);
			expect(Date.now() - began, "so they didn't wait for the timeout again").toBeLessThan(60);
		} finally {
			globalThis.fetch = fetchWas;
			newPage();
			document.head.innerHTML = "";
		}
	});

	it("issues a request again after the retry interval, so a server that recovers is detected", async () => {
		const fetchWas = globalThis.fetch;
		newPage();
		setHydration({ settings: servedWith({ responseTimeoutMs: 40 }) });
		hydrateFromDom();
		let made = 0;
		// The fake accepts the call and doesn't respond, so the timeout marks the site unreachable.
		globalThis.fetch = ((_url: string, init?: { signal?: AbortSignal }) => {
			made += 1;
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			const conduit = installServedConduit("", requiredActionOf);
			await expect(conduit.follow(reads(SHOW_STEPS_METHOD), "the first read")).rejects.toThrow();
			expect(made).toBe(1);
			await expect(conduit.follow(reads(SHOW_STEPS_METHOD), "a read within the span")).rejects.toThrow();
			expect(made, "the page doesn't call the site within the span, since the first call's timeout stands for it").toBe(1);
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(Date.now() + UNREACHABLE_RETRY_AFTER_MS);
			await expect(conduit.follow(reads(SHOW_STEPS_METHOD), "a read after it")).rejects.toThrow();
			expect(made, "and the page calls the site again after the span").toBe(2);
		} finally {
			vi.useRealTimers();
			globalThis.fetch = fetchWas;
			newPage();
			document.head.innerHTML = "";
		}
	});

	it("issues an act within that span, since a reader requested the act and a read's timeout isn't its result", async () => {
		// A question a reader types into the ask pane reaches the server even where a view's read timed out a moment
		// before. The page would otherwise refuse to send the reader's question.
		const fetchWas = globalThis.fetch;
		newPage();
		setHydration({ settings: servedWith({ responseTimeoutMs: 40 }) });
		hydrateFromDom();
		const asked: string[] = [];
		globalThis.fetch = ((url: string, init?: { signal?: AbortSignal }) => {
			asked.push(new URL(String(url)).pathname);
			if (String(url).endsWith(HANDSHAKE_PATH)) return Promise.resolve(rpcAnswer({ seqPath: [0, 1] }, 200));
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			const conduit = installServedConduit("", requiredActionOf);
			await expect(conduit.follow(reads(SHOW_STEPS_METHOD), "a view reading")).rejects.toThrow();
			const afterRead = asked.length;
			await expect(conduit.follow(acts("chatWithContext"), "the reader's question")).rejects.toThrow();
			expect(asked.slice(afterRead), "the page sent the act to the server, starting with the handshake that places it in actuality").toContain(HANDSHAKE_PATH);
			expect(asked.slice(afterRead), "and then the act itself").toContain("/rpc/chatWithContext");
		} finally {
			globalThis.fetch = fetchWas;
			newPage();
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
			const conduit = installServedConduit("", requiredActionOf);
			await expect(conduit.follow(acts(SHOW_STEPS_METHOD), "the first read")).rejects.toThrow();
			await expect(conduit.follow(acts(SHOW_STEPS_METHOD), "the read after it")).rejects.toThrow();
			expect(made, "each call reached fetch, since the network refusal returned at once").toBeGreaterThan(1);
		} finally {
			globalThis.fetch = fetchWas;
			newPage();
		}
	});

	it("reports a request the caller aborted as the caller's, not as an unreachable server", async () => {
		const fetchWas = globalThis.fetch;
		setHydration({ settings: SERVED_SETTINGS });
		hydrateFromDom();
		globalThis.fetch = ((url: string, init?: { signal?: AbortSignal }) => {
			// The fake responds to the call that opens an action. It accepts the streamed read and doesn't respond, so only
			// the reader's abort settles that read.
			if (String(url).endsWith(HANDSHAKE_PATH)) return Promise.resolve(rpcAnswer({ seqPath: [0, 1] }, 200));
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true }));
		}) as unknown as typeof globalThis.fetch;
		try {
			const stopping = new AbortController();
			const following = installServedConduit("", requiredActionOf)
				.followStream(acts(SHOW_STEPS_METHOD), () => undefined, { why: "a reader reading", signal: stopping.signal })
				.then(
					() => undefined,
					(e: unknown) => e,
				);
			await new Promise((r) => setTimeout(r, 5));
			stopping.abort();
			const err = await following;
			expect(err, "a reader's abort doesn't show whether the site responds").not.toBeInstanceOf(ServerUnreachable);
		} finally {
			globalThis.fetch = fetchWas;
			document.head.innerHTML = "";
		}
	});

	it("an error the server returns isn't unreachability", async () => {
		const fetchWas = globalThis.fetch;
		globalThis.fetch = () => Promise.resolve(rpcAnswer({ error: "no such step" }, 422));
		try {
			const err = await installServedConduit("", requiredActionOf)
				.follow(acts(SHOW_STEPS_METHOD), "test")
				.then(
					() => undefined,
					(e: unknown) => e,
				);
			expect(isServerUnreachable(err)).toBe(false);
		} finally {
			globalThis.fetch = fetchWas;
		}
	});
});
