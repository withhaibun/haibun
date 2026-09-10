/**
 * Hypermedia — the SPA-side core of shu's wire layer. One file holds the wire
 * types, link helpers, the affordance union, the `Conduit` interface, both
 * implementations, and the module accessor. Components and infrastructure
 * import from this one path; tests use `setupShuTest` to install a
 * `LiveConduit`. Nothing else talks to `/rpc/*`, and nothing else owns
 * the active conduit reference.
 *
 * A Resource (linked-data sense — an Email node, a Comment, any consumer
 * record) becomes a `TRepresentation` on the wire: the domain fields plus
 * optional hypermedia markers (`_type`, `_summary`, `_description`, `_links`,
 * `_seqPath`). A `TLink` in `_links` is a named follow-up call; `TAffordance`
 * is the SPA's view of a clickable user action (a follow, a step pick, or a
 * column open).
 *
 * Every wire call carries a `why`. The explainable-system trace is non-
 * optional: `follow(link, why)`, `followStream(link, onChunk, { why })`, and
 * `group(why, fn)` all surface it to the server's observation graph via
 * `action.begin`.
 */

// Type-only import — erased from the browser bundle (never pulls core's node:async_hooks runtime).
import type { TStreamChunk } from "@haibun/core/lib/step-stream-context.js";
import { pagePinned } from "./page-pinned.js";
// The wire itself: envelope and stream reader, shared with every other caller of a haibun host. Free of node imports.
import { rpcEnvelope, readNdjson } from "@haibun/core/lib/rpc-wire.js";
import { findStep, responseTimeoutMs } from "./rpc-registry.js";
import { sessionReady, signedHeaders } from "./session-key.js";

// ─── Wire types ──────────────────────────────────────────────────────────────

/** Wire link: a named action the consumer can invoke next. The shape every haibun step emits in `_links`. `method` is the full `Stepper-methodName` the server dispatches — the wire contract; each call site names the method it follows, the server rejects unknown methods at runtime. */
/**
 * What a call asks of a run: to be answered, or to act.
 *
 * A run answers a read and records nothing of it, since reading a run is not an act of the run. A run asked to act
 * records what it did. A link states which it asks for, and the run holds that statement to the step's own
 * declaration, refusing to answer as a read a step that does not declare itself one. Stated on the link rather than
 * inferred at the far end, a page cannot read through a step whose answer the run would record, and cannot forget to
 * say which it wants: `asks` is required, so `reads` and `acts` are the only ways to make a link.
 */
export type TAsks = "read" | "act";

export type TLink = { method: string; params?: Record<string, unknown>; summary?: string; asks: TAsks };

/** A link to read a run through. The run answers it and records nothing of the reading. */
export const reads = (method: string, params?: Record<string, unknown>, summary?: string): TLink => ({ method, params, summary, asks: "read" });

/** A link that asks a run to act. What it does is the run's own activity, and is recorded as such. */
export const acts = (method: string, params?: Record<string, unknown>, summary?: string): TLink => ({ method, params, summary, asks: "act" });

/** Wire-format Representation of a Resource. Hypermedia markers are optional — a bare projection without `_links` is still a Representation; the type is the wire shape, not a promise of affordances. */
export type TRepresentation = {
	_type?: string;
	_summary?: string;
	_description?: string;
	_links?: Record<string, TLink>;
	_seqPath?: number[];
	[key: string]: unknown;
};

/** One streaming chunk delivered to `followStream`'s `onChunk` callback — re-exported from core so the server emitter and this consumer share one definition. */
export type { TStreamChunk };

/** SPA-side clickable user action. Three kinds cover every existing pattern: `follow` invokes an RPC and surfaces its Representation; `pick-step` pre-fills the step-caller with a method (no RPC); `open-view` opens a column for a subject. Server-emitted `_links` rels become `kind: "follow"` affordances. */
export type TAffordance =
	| { kind: "follow"; label: string; summary?: string; method: string; params?: Record<string, unknown>; why: string }
	| { kind: "pick-step"; label: string; summary?: string; method: string }
	| { kind: "open-view"; label: string; summary?: string; subject: string; persistedAs: string };

// ─── Guards ──────────────────────────────────────────────────────────────────

/** True iff `rep._links` has a well-formed entry under `rel`. Use before `getLink` when the rel is optional ("render the trace affordance only if present"). */
export function hasLink(rep: TRepresentation, rel: string): boolean {
	const link = rep._links?.[rel];
	return !!link && typeof link === "object" && typeof (link as TLink).method === "string";
}

/** Resolve one named affordance. Throws if absent or malformed — every unexpected path throws; callers use `hasLink` when the rel is genuinely optional. */
export function getLink(rep: TRepresentation, rel: string): TLink {
	const links = rep._links;
	if (!links || typeof links !== "object") {
		throw new Error(`getLink("${rel}"): Representation has no _links (type=${rep._type ?? "<unset>"})`);
	}
	const link = (links as Record<string, unknown>)[rel];
	if (!link || typeof link !== "object" || typeof (link as TLink).method !== "string") {
		const have = Object.keys(links).join(", ") || "<none>";
		throw new Error(`getLink("${rel}"): rel not in _links (have: ${have})`);
	}
	return link as TLink;
}

// ─── Conduit interface ───────────────────────────────────────────────────────

/** The single contract for outbound calls from shu to the haibun service. `LiveConduit` runs against a real server; a test installs one of its own against an in-memory map (tests and offline shu.html). The signature is identical so call sites are unaware which they're using. */
export interface Conduit {
	/** One-shot RPC. The result is typed as `T` (defaulting to `TRepresentation`); callers narrow to their expected wire shape. `why` describes user intent; it travels to the server's observation graph via the underlying action. Throws on transport failure, server error, or malformed response. */
	follow<T = TRepresentation>(link: TLink, why: string): Promise<T>;

	/** Streaming RPC. `onChunk` is invoked per incoming chunk. `opts.onStart` fires once with the allocated seqPath before any chunk arrives (used by callers that need to stamp the DOM before content streams in). `opts.signal` aborts the in-flight stream. `why` records intent. Resolves with the seqPath the server assigned. */
	followStream(
		link: TLink,
		onChunk: (chunk: TStreamChunk) => void,
		opts: { why: string; signal?: AbortSignal; onStart?: (seqPath: number[]) => void },
	): Promise<{ seqPath: number[] }>;

	/** Group a set of follows into one tracked action. Every `follow` made via the `g` passed to `fn` is a child of one parent seqPath; siblings of each other in the trace. Concurrent `group` invocations are independent because each receives its own `g` — there is no module-level scope to share accidentally. */
	group<T>(why: string, fn: (g: Conduit) => Promise<T>): Promise<T>;
}

// ─── LiveConduit ─────────────────────────────────────────────────────────────

type ActionScope = { readonly root: readonly number[]; subSeq: number };

let rpcCounter = 0;
function nextRpcId(): string {
	rpcCounter += 1;
	return `rpc-${rpcCounter}-${Date.now().toString(36)}`;
}

function formatRpcError(method: string, status: number, data: unknown): string {
	if (data && typeof data === "object") {
		const error = (data as { error?: unknown }).error;
		if (typeof error === "string" && error.length > 0) return error;
		if (error instanceof Error && error.message) return error.message;
	}
	if (typeof data === "string" && data.length > 0) return data;
	return `${method}: RPC failed with status ${status}`;
}

/**
 * What every call from this page carries. A call to a step that requires authority is signed with the key this reader
 * controls, over that request: the address, the method and the body, naming the capability the step declares. A call
 * to a step that requires none carries nothing, since there is nothing to prove.
 */
async function rpcHeaders(url: string, method: string, body: string): Promise<Record<string, string>> {
	// One header set, written once and in one casing: a signature covers the headers as they are sent, and the same
	// header given twice in two casings arrives as one header carrying both values, which is not what was signed.
	const base: Record<string, string> = { "content-type": "application/json" };
	const required = findStep(method)?.capability;
	if (!required) return base;
	// Only a call that needs authority waits for the session: the page opens one while it renders, and a reader doing
	// something that needs nothing never waits for it, nor is stopped by a deployment that gives readers nothing.
	await sessionReady();
	// What is signed is the address the request is actually made to: a proof over a relative path proves nothing about
	// where it was sent, and the boundary checks the absolute one it received. The body is signed as the string it is
	// sent as, so the digest the proof carries is over those bytes.
	const asked = new URL(url, location.href);
	const signed = await signedHeaders({ url: asked.toString(), method: "POST", headers: { ...base, host: asked.host }, body, action: required });
	return signed ?? base;
}

/** `Conduit` implementation against a running haibun service. Sole owner of the SPA's RPC fetch path — wire envelope (jsonrpc + seqPath), `action.begin` allocation, NDJSON streaming reader, and error formatting all live here. Action scope is explicit via the `scope` constructor argument: a top-level instance has none and allocates one per `follow`; a `group`-issued child has a bound scope and appends sub-sequences to it. Concurrent groups can't accidentally share scope because nothing is module-level. */
/** The server could not be reached: the request never got a response, so nothing is known about what it asked. A
 *  deployment state a view reports (the reader is offline, the server is stopped), not a fault to fail on; every other
 *  failure, including an error the server itself returns, stays a fault. */
export class ServerUnreachable extends Error {
	constructor(
		readonly url: string,
		cause: unknown,
	) {
		super(`the server did not respond to ${url}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
		this.name = "ServerUnreachable";
	}
}

/** Whether a failure is the server being unreachable, however deep in a chain of causes it was raised. */
export function isServerUnreachable(err: unknown): boolean {
	for (let e: unknown = err, depth = 0; e && depth < 8; e = (e as { cause?: unknown }).cause, depth++) if (e instanceof ServerUnreachable) return true;
	return false;
}

export class LiveConduit implements Conduit {
	constructor(
		private readonly basePath: string = "",
		private readonly scope: ActionScope | null = null,
	) {}

	async follow<T = TRepresentation>(link: TLink, why: string): Promise<T> {
		// Reading a run does not begin an action of it: a read carries no place in the run's own sequence, and asking for
		// one is a call of its own, made per read, by every page following the run. Acting does begin one, since what the
		// run then does belongs in the sequence at that place.
		const seqPath = link.asks === "read" ? undefined : await this.allocateSeqPath(why);
		const res = await this.post(link.method, { method: link.method, params: link.params ?? {}, seqPath, asks: link.asks });
		const data: unknown = await res.json();
		if (!res.ok || (data && typeof data === "object" && "error" in (data as Record<string, unknown>) && (data as { error?: unknown }).error)) {
			throw new Error(formatRpcError(link.method, res.status, data));
		}
		return data as T;
	}

	async followStream(
		link: TLink,
		onChunk: (chunk: TStreamChunk) => void,
		opts: { why: string; signal?: AbortSignal; onStart?: (seqPath: number[]) => void },
	): Promise<{ seqPath: number[] }> {
		const seqPath = await this.allocateSeqPath(opts.why);
		opts.onStart?.(seqPath);
		const res = await this.post(link.method, { method: link.method, params: link.params ?? {}, seqPath, stream: true, asks: link.asks }, opts.signal);
		if (!res.ok) throw new Error(`${link.method}: stream RPC failed with status ${res.status}`);
		if (!res.body) throw new Error(`${link.method}: stream RPC returned no body`);
		for await (const chunk of readNdjson<TStreamChunk>(res.body)) {
			if (chunk.error) throw new Error(chunk.error);
			onChunk(chunk);
		}
		return { seqPath };
	}

	async group<T>(why: string, fn: (g: Conduit) => Promise<T>): Promise<T> {
		const root = await this.beginAction(why);
		return fn(new LiveConduit(this.basePath, { root, subSeq: 0 }));
	}

	private allocateSeqPath(why: string): Promise<number[]> {
		if (this.scope) {
			this.scope.subSeq += 1;
			return Promise.resolve([...this.scope.root, this.scope.subSeq]);
		}
		return this.beginAction(why);
	}

	// The one wire write: envelope, headers (signed where the step requires authority), POST. Every request above rides it.
	private async post(method: string, envelope: Omit<Parameters<typeof rpcEnvelope>[0], "id">, signal?: AbortSignal): Promise<Response> {
		const url = `${this.basePath}/rpc/${method}`;
		const body = rpcEnvelope({ id: nextRpcId(), ...envelope });
		// A request the server accepts without responding to is indistinguishable from an unreachable server, so a
		// request the page awaits carries a timeout. A caller that supplied a signal governs its own request, and a
		// stream stays open for as long as the run writes to it, so neither is one this timeout applies to.
		const awaited = signal === undefined && envelope.stream !== true;
		// Within the retry interval of a timed-out request, no further request is issued: the previous timeout is the
		// result, since a page with several views open would otherwise run each read to the timeout separately. The
		// timeout is allocated after this, so a request that is not issued allocates no timer.
		if (awaited && isUnreachable()) throw new ServerUnreachable(url, new Error("a request to this server timed out within the last interval"));
		const bounded = awaited ? AbortSignal.timeout(responseTimeoutMs()) : signal;
		try {
			const res = await fetch(url, { method: "POST", headers: await rpcHeaders(url, method, body), body, signal: bounded });
			const state = responded();
			state.at = Date.now();
			state.unreachableUntil = 0;
			return res;
		} catch (err) {
			if (signal?.aborted) throw err; // the caller stopped this request; the server's reachability is not in question
			// Only a timeout withholds later requests. A request the network refuses fails immediately, so the next read
			// costs nothing by issuing one, and a server that recovers is detected on that read.
			if (bounded?.aborted) responded().unreachableUntil = Date.now() + UNREACHABLE_RETRY_AFTER_MS;
			throw new ServerUnreachable(url, err);
		}
	}

	private async beginAction(why: string): Promise<number[]> {
		const res = await this.post("action.begin", { method: "action.begin", params: { why } });
		const data: unknown = await res.json();
		if (!res.ok || !data || typeof data !== "object" || !("seqPath" in (data as Record<string, unknown>))) {
			throw new Error(formatRpcError("action.begin", res.status, data));
		}
		const seqPath = (data as { seqPath?: unknown }).seqPath;
		if (!Array.isArray(seqPath) || seqPath.length === 0) throw new Error("action.begin returned no seqPath");
		return seqPath as number[];
	}
}

// ─── Accessor ────────────────────────────────────────────────────────────────

/** When the server last responded to this page, whatever it answered. A reader looking at what the page holds can tell
 *  whether it is current; a page that has never reached a server has nothing here. Held by the page, since a request
 *  from any bundle is this page reaching the server. */
const RESPONDED_KEY = "__SHU_SERVER_RESPONDED__";
const responded = (): { at: number | undefined; unreachableUntil: number } => pagePinned(RESPONDED_KEY, () => ({ at: undefined, unreachableUntil: 0 }));

/**
 * How long a request is withheld after one timed out, before the page issues another.
 *
 * A page issues one request per read, and a reader with several views open issues many concurrently. Without this,
 * each would run to the response timeout independently, so an unresponsive server would cost every read that full
 * duration and the page would spend its time waiting rather than querying the device store. One timed-out request
 * stands for the rest over this interval, after which the next read issues a request again.
 */
export const UNREACHABLE_RETRY_AFTER_MS = 2_000;

/** Whether a request timed out within the retry interval, so another would only run to the timeout again. */
const isUnreachable = (): boolean => Date.now() < responded().unreachableUntil;

export function serverLastRespondedAt(): number | undefined {
	return responded().at;
}

/** The active Conduit lives on `globalThis` keyed by a globally-registered Symbol so bundles that are built separately (e.g. esbuild emits per-component bundles for slot extensions) share one installation instead of each carrying its own module-level cell. Without this, `setConduit` in the SPA bundle wouldn't be visible to a slot-extension component bundle, and its `conduit()` would throw at first use. */
const CONDUIT_SLOT = Symbol.for("@haibun/shu/active-conduit");
type ConduitGlobal = { [CONDUIT_SLOT]?: Conduit | null };
const conduitGlobal = globalThis as ConduitGlobal;

/** Boot installs one Conduit; every component, infrastructure module, and test reads via `conduit()`. */
export function setConduit(c: Conduit): void {
	conduitGlobal[CONDUIT_SLOT] = c;
}

/** Returns the active Conduit. Throws if boot didn't install one — the only way this happens in production is a programming error in `app.ts`; in tests every `beforeEach` calls `setupShuTest({...})`, so a forgotten setup throws with a precise message naming the missing instance. */
export function conduit(): Conduit {
	const active = conduitGlobal[CONDUIT_SLOT];
	if (!active) {
		throw new Error("conduit: no Conduit installed. Call setConduit() in app boot or setupShuTest() in tests before using conduit().");
	}
	return active;
}

/** Whether boot has installed a Conduit. A page mounted without one (a bundle under test, a still) has no run for its
 *  batches, and a channel that checks first never throws. */
export function hasConduit(): boolean {
	return Boolean(conduitGlobal[CONDUIT_SLOT]);
}

/** Test-only: clear the active conduit so subsequent setConduit calls are clean. */
export function resetConduit(): void {
	conduitGlobal[CONDUIT_SLOT] = null;
}
