/**
 * Hypermedia: the SPA-side core of shu's wire layer. One file holds the wire
 * types, link helpers, the `Conduit` interface, both
 * implementations, and the module accessor. Components and infrastructure
 * import from this one path; tests use `setupShuTest` to install a
 * `LiveConduit`. Other code doesn't call `/rpc/*` or own
 * the active conduit reference.
 *
 * A Resource (linked-data sense: an Email node, a Comment, any consumer
 * record) becomes a `TRepresentation` on the wire: the domain fields plus
 * optional hypermedia markers (`_type`, `_summary`, `_description`, `_links`,
 * `_seqPath`). A `TLink` in `_links` is a named follow-up call.
 *
 * Every wire call carries a `why`. The explainable-system trace is non-
 * optional: `follow(link, why)`, `followStream(link, onChunk, { why })`, and
 * `group(why, fn)` all surface it to the server's observation graph via
 * `action.begin`.
 */

// Type-only import, erased from the browser bundle (never pulls core's node:async_hooks runtime).
import type { TStreamChunk } from "@haibun/core/lib/step-stream-context.js";
import { z } from "zod";
import { pagePinned } from "./page-pinned.js";
// The wire itself: envelope and stream reader, shared with every other caller of a haibun host. Free of node imports.
import { buildRpcCall, readNdjson, readRpcAnswer, type TProveRequest, type TRpcEnvelope } from "@haibun/core/lib/rpc-wire.js";
import { findStep, responseTimeoutMs } from "./rpc-registry.js";
import { keyHeaders, pageAuthorityReady, signedHeaders } from "./page-key.js";
import { DELEGATIONS_READ_METHOD } from "@haibun/core/lib/authority-types.js";
import { SHOW_STEPS_ACTION, SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";

// ─── Wire types ──────────────────────────────────────────────────────────────

/** Wire link: a named action the consumer can invoke next. The shape every haibun step emits in `_links`. `method` is the full `Stepper-methodName` the server dispatches: the wire contract; each call site names the method it follows, the server rejects unknown methods at runtime. */
/**
 * What a call asks of a run: to be answered, or to act.
 *
 * A run answers a read and doesn't record it, since reading a run is not an act of the run. A run asked to act
 * records what it did. A link states which it asks for, and actuality holds that statement to the step's own
 * declaration, refusing to answer as a read a step that does not declare itself one. Stated on the link rather than
 * inferred at the far end, a page cannot read through a step whose answer actuality would record, and cannot forget to
 * say which it wants: `asks` is required, so `reads` and `acts` are the only ways to make a link.
 */
type TAsks = "read" | "act";

export type TLink = { method: string; params?: Record<string, unknown>; summary?: string; asks: TAsks };

/** A link to read a run through. The run answers it and doesn't record the reading. */
export const reads = (method: string, params?: Record<string, unknown>, summary?: string): TLink => ({ method, params, summary, asks: "read" });

/** A link that asks a run to act. What it does is the run's own activity, and is recorded as such. */
export const acts = (method: string, params?: Record<string, unknown>, summary?: string): TLink => ({ method, params, summary, asks: "act" });

/** Wire-format Representation of a Resource. Hypermedia markers are optional: a bare projection without `_links` is still a Representation; the type is the wire shape, not a promise of affordances. */
export type TRepresentation = {
	_type?: string;
	_summary?: string;
	_description?: string;
	_links?: Record<string, TLink>;
	_seqPath?: number[];
	[key: string]: unknown;
};

/** One streaming chunk delivered to `followStream`'s `onChunk` callback, re-exported from core so the server emitter and this consumer share one definition. */
export type { TStreamChunk };

// ─── Guards ──────────────────────────────────────────────────────────────────

/** True iff `rep._links` has a well-formed entry under `rel`. Use before `getLink` when the rel is optional ("render the trace affordance only if present"). */
export function hasLink(rep: TRepresentation, rel: string): boolean {
	const link = rep._links?.[rel];
	return !!link && typeof link === "object" && typeof link.method === "string";
}

/** Resolve one named affordance. Throws if absent or malformed: every unexpected path throws; callers use `hasLink` when the rel is optional. */
export function getLink(rep: TRepresentation, rel: string): TLink {
	const links = rep._links;
	if (!links || typeof links !== "object") {
		throw new Error(`getLink("${rel}"): Representation has no _links (type=${rep._type ?? "<unset>"})`);
	}
	const link = links[rel];
	if (!link || typeof link !== "object" || typeof link.method !== "string") {
		const have = Object.keys(links).join(", ") || "<none>";
		throw new Error(`getLink("${rel}"): rel not in _links (have: ${have})`);
	}
	return link;
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

	/** Group a set of follows into one tracked action. Every `follow` made via the `g` passed to `fn` is a child of one parent seqPath; siblings of each other in the trace. Concurrent `group` invocations are independent because each receives its own `g`: the conduit doesn't keep a module-level scope that could be shared accidentally. */
	group<T>(why: string, fn: (g: Conduit) => Promise<T>): Promise<T>;
}

// ─── LiveConduit ─────────────────────────────────────────────────────────────

type ActionScope = { readonly root: readonly number[]; subSeq: number };

/** How many calls the page has numbered, across its bundles, so two calls on the page don't share an id. */
const RPC_IDS_KEY = "__SHU_RPC_IDS__";
const issuedRpcIds = (): { count: number } => pagePinned(RPC_IDS_KEY, () => ({ count: 0 }));
function nextRpcId(): string {
	const issued = issuedRpcIds();
	issued.count += 1;
	return `rpc-${issued.count}-${Date.now().toString(36)}`;
}

/** What actuality answers `action.begin` with: the place in its sequence the act is recorded at. */
const ActionBeganSchema = z.object({ seqPath: z.array(z.number()).min(1) });

/** Actuality's answer to a call, or the refusal it stated, thrown. */
async function answerOf(method: string, res: Response): Promise<unknown> {
	const answer = await readRpcAnswer(method, res);
	if (answer.kind === "refused") throw new Error(answer.error);
	return answer.body;
}

/**
 * How a call from this page to `method` is proven. A call to a step is signed with the key this reader controls, over
 * the request, under a delegation that allows the action the step requires. The delegation read proves the key alone,
 * since it is how the page learns what else it holds. A call for which the page doesn't hold a delegation doesn't carry one, which
 * the deployment may allow without a delegation.
 */
function provingFor(method: string): TProveRequest {
	return async (request) => {
		if (method === DELEGATIONS_READ_METHOD) return await keyHeaders(request);
		// Discovery is how the page learns the steps, so what it requires is the one action the page knows without asking.
		const required = method === SHOW_STEPS_METHOD ? SHOW_STEPS_ACTION : findStep(method)?.capability;
		if (!required) return request.headers;
		// A call waits for what the page holds, which the page reads while it boots, and says so there if it could not.
		await pageAuthorityReady();
		return (await signedHeaders({ ...request, action: required })) ?? request.headers;
	};
}

const SERVER_UNREACHABLE = "ServerUnreachable";

/** The server could not be reached: the request never got a response, so the outcome of what it asked is unknown. A
 *  deployment state a view reports (the reader is offline, the server is stopped), not a fault to fail on; every other
 *  failure, including an error the server itself returns, stays a fault. */
export class ServerUnreachable extends Error {
	constructor(
		readonly url: string,
		cause: unknown,
	) {
		super(`the server did not respond to ${url}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
		this.name = SERVER_UNREACHABLE;
	}
}

/** Whether a failure, or one it was caused by, is the server not responding. Read by name, since each bundle on the page
 *  has its own copy of the class and a conduit one bundle installed fails with its own. */
export function isServerUnreachable(err: unknown): boolean {
	for (let e: unknown = err, depth = 0; e && depth < 8; e = (e as { cause?: unknown }).cause, depth++) if ((e as { name?: unknown }).name === SERVER_UNREACHABLE) return true;
	return false;
}

/** `Conduit` implementation against a running haibun service. Sole owner of the SPA's RPC fetch path, wire envelope (jsonrpc + seqPath), `action.begin` allocation, NDJSON streaming reader, and error formatting all live here. Action scope is explicit via the `scope` constructor argument: a top-level instance doesn't have one and allocates one per `follow`; a `group`-issued child has a bound scope and appends sub-sequences to it. Concurrent groups can't accidentally share scope because the scope isn't module-level. */
export class LiveConduit implements Conduit {
	constructor(
		private readonly basePath: string = "",
		private readonly scope: ActionScope | null = null,
	) {}

	async follow<T = TRepresentation>(link: TLink, why: string): Promise<T> {
		// Reading a run does not begin an action of it: a read doesn't carry a place in the run's own sequence, and asking for
		// one is a call of its own, made per read, by every page following actuality. Acting does begin one, since what the
		// run then does belongs in the sequence at that place.
		const seqPath = link.asks === "read" ? undefined : await this.allocateSeqPath(why);
		const res = await this.post(link.method, { method: link.method, params: link.params ?? {}, seqPath, asks: link.asks });
		return (await answerOf(link.method, res)) as T;
	}

	async followStream(
		link: TLink,
		onChunk: (chunk: TStreamChunk) => void,
		opts: { why: string; signal?: AbortSignal; onStart?: (seqPath: number[]) => void },
	): Promise<{ seqPath: number[] }> {
		const seqPath = await this.allocateSeqPath(opts.why);
		opts.onStart?.(seqPath);
		const res = await this.post(link.method, { method: link.method, params: link.params ?? {}, seqPath, stream: true, asks: link.asks }, opts.signal);
		// A stream actuality refused answers with its refusal, as any call does.
		if (!res.ok) await answerOf(link.method, res);
		if (!res.body) throw new Error(`${link.method}: stream RPC didn't return a body`);
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
	private async post(method: string, envelope: Omit<TRpcEnvelope, "id">, signal?: AbortSignal): Promise<Response> {
		// What is signed is the address the request is made to: a proof over a relative path doesn't prove where
		// it was sent, and the boundary checks the absolute one it received.
		const base = new URL(`${this.basePath}/`, location.origin).href;
		// A request the server accepts without responding to is indistinguishable from an unreachable server, so a
		// request the page awaits carries a timeout. A caller that supplied a signal governs its own request, and a
		// stream stays open for as long as actuality writes to it, so this timeout doesn't apply to either.
		const awaited = signal === undefined && envelope.stream !== true;
		// Within the retry interval of a timed-out read, a further read isn't issued: the previous timeout is the result,
		// since a page with several views open would otherwise run each read to the timeout separately. An act is issued
		// whatever a read did, because a reader asked for it: a question typed into the page is not answered by a read
		// that timed out a moment ago. The timeout is allocated after this, so a request that is not issued doesn't allocate a
		// timer.
		if (awaited && envelope.asks !== "act" && isUnreachable()) throw new ServerUnreachable(base, new Error("a read of this server timed out within the last interval"));
		const call = await buildRpcCall(base, { id: nextRpcId(), ...envelope }, provingFor(method));
		const bounded = awaited ? AbortSignal.timeout(responseTimeoutMs()) : signal;
		try {
			const res = await fetch(call.url, { ...call.init, signal: bounded });
			const state = responded();
			state.at = Date.now();
			state.unreachableUntil = 0;
			return res;
		} catch (err) {
			if (signal?.aborted) throw err; // the caller stopped this request; the server's reachability is not in question
			// Only a timeout withholds later requests. A request the network refuses fails immediately, so issuing the next read
			// doesn't delay the page, and a server that recovers is detected on that read.
			if (bounded?.aborted) responded().unreachableUntil = Date.now() + UNREACHABLE_RETRY_AFTER_MS;
			throw new ServerUnreachable(call.url, err);
		}
	}

	private async beginAction(why: string): Promise<number[]> {
		// Beginning an action is part of acting: it allocates the place in actuality's sequence the act is recorded at.
		const res = await this.post("action.begin", { method: "action.begin", params: { why }, asks: "act" });
		return ActionBeganSchema.parse(await answerOf("action.begin", res)).seqPath;
	}
}

// ─── Accessor ────────────────────────────────────────────────────────────────

/** When the server last responded to this page, whatever it answered. A reader looking at what the page holds can tell
 *  whether it is current; a page that has never reached a server doesn't have a value here. Held by the page, since a request
 *  from any bundle is this page reaching the server. */
const RESPONDED_KEY = "__SHU_SERVER_RESPONDED__";
const responded = (): { at: number | undefined; unreachableUntil: number } => pagePinned(RESPONDED_KEY, () => ({ at: undefined, unreachableUntil: 0 }));

/**
 * How long a request is withheld after one timed out, before the page issues another.
 *
 * A page issues one request per read, and a reader with several views open issues many concurrently. Without this,
 * each would run to the response timeout independently, so an unresponsive server would take every read that full
 * duration and the page would use its time waiting rather than querying the device store. One timed-out request
 * stands for the rest over this interval, after which the next read issues a request again.
 */
const UNREACHABLE_RETRY_AFTER_MS = 2_000;

/** Whether a request timed out within the retry interval, so another would only run to the timeout again. */
const isUnreachable = (): boolean => Date.now() < responded().unreachableUntil;

export function serverLastRespondedAt(): number | undefined {
	return responded().at;
}

/** The active Conduit is the page's, so bundles that are built separately (e.g. esbuild emits per-component bundles for slot extensions) share one installation instead of each carrying its own module-level cell. Without this, `setConduit` in the SPA bundle wouldn't be visible to a slot-extension component bundle, and its `conduit()` would throw at first use. */
const CONDUIT_KEY = "__SHU_CONDUIT__";
const installedConduit = (): { conduit?: Conduit } => pagePinned(CONDUIT_KEY, () => ({}));

/** Boot installs one Conduit; every component, infrastructure module, and test reads via `conduit()`. */
export function setConduit(c: Conduit): void {
	installedConduit().conduit = c;
}

/** Returns the active Conduit. Throws if boot didn't install one: the only way this happens in production is a programming error in `app.ts`; in tests every `beforeEach` calls `setupShuTest({...})`, so a forgotten setup throws with a precise message naming the missing instance. */
export function conduit(): Conduit {
	const active = installedConduit().conduit;
	if (!active) {
		throw new Error("conduit: a Conduit isn't installed. Call setConduit() in app boot or setupShuTest() in tests before using conduit().");
	}
	return active;
}

/** Whether boot has installed a Conduit. A page mounted without one (a bundle under test, a still) doesn't have a run for its
 *  batches, and a channel that checks first never throws. */
export function hasConduit(): boolean {
	return installedConduit().conduit !== undefined;
}
