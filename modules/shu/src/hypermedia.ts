/**
 * Hypermedia — the SPA-side core of shu's wire layer. One file holds the wire
 * types, link helpers, the affordance union, the `Conduit` interface, both
 * implementations, and the module accessor. Components and infrastructure
 * import from this one path; tests use `setupShuTest` to install a
 * `SerializedConduit`. Nothing else talks to `/rpc/*`, and nothing else owns
 * the active conduit reference.
 *
 * A Resource (linked-data sense — an Email node, a Comment, an issued
 * credential) becomes a `TRepresentation` on the wire: the domain fields plus
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

// ─── Wire types ──────────────────────────────────────────────────────────────

/** Wire link: a named action the consumer can invoke next. The shape every haibun step emits in `_links`. `method` is the full `Stepper-methodName` the server dispatches — the wire contract; each call site names the method it follows, the server rejects unknown methods at runtime. */
export type TLink = { method: string; params?: Record<string, unknown>; summary?: string };

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

/** The single contract for outbound calls from shu to the haibun service. `LiveConduit` runs against a real server; `SerializedConduit` against an in-memory map (tests and offline shu.html). The signature is identical so call sites are unaware which they're using. */
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

/** `Conduit` implementation against a running haibun service. Sole owner of the SPA's RPC fetch path — wire envelope (jsonrpc + seqPath), `action.begin` allocation, NDJSON streaming reader, and error formatting all live here. Action scope is explicit via the `scope` constructor argument: a top-level instance has none and allocates one per `follow`; a `group`-issued child has a bound scope and appends sub-sequences to it. Concurrent groups can't accidentally share scope because nothing is module-level. */
export class LiveConduit implements Conduit {
	constructor(
		private readonly basePath: string = "",
		private readonly scope: ActionScope | null = null,
	) {}

	async follow<T = TRepresentation>(link: TLink, why: string): Promise<T> {
		const seqPath = await this.allocateSeqPath(why);
		const id = nextRpcId();
		const res = await fetch(`${this.basePath}/rpc/${link.method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id, method: link.method, params: link.params ?? {}, seqPath }),
		});
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
		const id = nextRpcId();
		const res = await fetch(`${this.basePath}/rpc/${link.method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id, method: link.method, params: link.params ?? {}, seqPath, stream: true }),
			signal: opts.signal,
		});
		if (!res.ok) throw new Error(`${link.method}: stream RPC failed with status ${res.status}`);
		if (!res.body) throw new Error(`${link.method}: stream RPC returned no body`);
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line) continue;
				const chunk = JSON.parse(line) as TStreamChunk;
				if (chunk.error) throw new Error(chunk.error);
				onChunk(chunk);
			}
		}
		if (buffer.trim()) {
			const chunk = JSON.parse(buffer) as TStreamChunk;
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

	private async beginAction(why: string): Promise<number[]> {
		const id = nextRpcId();
		const res = await fetch(`${this.basePath}/rpc/action.begin`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id, method: "action.begin", params: { why } }),
		});
		const data: unknown = await res.json();
		if (!res.ok || !data || typeof data !== "object" || !("seqPath" in (data as Record<string, unknown>))) {
			throw new Error(formatRpcError("action.begin", res.status, data));
		}
		const seqPath = (data as { seqPath?: unknown }).seqPath;
		if (!Array.isArray(seqPath) || seqPath.length === 0) throw new Error("action.begin returned no seqPath");
		return seqPath as number[];
	}
}

// ─── SerializedConduit ───────────────────────────────────────────────────────

/** Caller-supplied function that returns a wire result for `(method, params)`. Throw to signal "no fixture for this call" — `SerializedConduit` surfaces the throw directly so tests get loud, named failures naming the unmocked method. */
export type TDispatch = (method: string, params: Record<string, unknown>) => unknown | Promise<unknown>;

/** `Conduit` implementation that dispatches against an in-memory function. Powers two real modes with one implementation: the offline shu.html report (boot wraps an embedded JSON map of frozen responses) and tests (setupShuTest constructs one with an inline `dispatch`). Components are unaware they're not talking to a server. `group` does not call `action.begin` — there is no server to allocate seqPaths and the `why` carries no observation graph to write to; the same instance is passed as the group's `g` so the API semantic ("every follow inside `fn` belongs to one logical action") survives at the contract level. */
export class SerializedConduit implements Conduit {
	constructor(private readonly dispatch: TDispatch) {}

	async follow<T = TRepresentation>(link: TLink, _why: string): Promise<T> {
		const result = await this.dispatch(link.method, link.params ?? {});
		return result as T;
	}

	async followStream(
		link: TLink,
		onChunk: (chunk: TStreamChunk) => void,
		opts: { why: string; signal?: AbortSignal; onStart?: (seqPath: number[]) => void },
	): Promise<{ seqPath: number[] }> {
		const seqPath = [0];
		opts.onStart?.(seqPath);
		const result = await this.dispatch(link.method, link.params ?? {});
		if (Array.isArray(result)) for (const chunk of result) onChunk(chunk as TStreamChunk);
		else onChunk(result as TStreamChunk);
		return { seqPath };
	}

	group<T>(_why: string, fn: (g: Conduit) => Promise<T>): Promise<T> {
		return fn(this);
	}
}

// ─── Accessor ────────────────────────────────────────────────────────────────

/** The active Conduit lives on `globalThis` keyed by a globally-registered Symbol so bundles that are built separately (e.g. esbuild emits per-component bundles for slot extensions) share one installation instead of each carrying its own module-level cell. Without this, `setConduit` in the SPA bundle wouldn't be visible to a slot-extension component bundle, and its `conduit()` would throw at first use. */
const CONDUIT_SLOT = Symbol.for("@haibun/shu/active-conduit");
type ConduitGlobal = { [CONDUIT_SLOT]?: Conduit | null };
const conduitGlobal = globalThis as ConduitGlobal;

/** SPA boot installs one Conduit (live or serialized); every component, infrastructure module, and test reads via `conduit()`. */
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

/** True iff the installed Conduit is the serialized (no live server) variant. Offline mode is derived from Conduit identity so the single source of truth is which Conduit was installed at boot. Safe to call before any Conduit is installed — returns false. */
export function isOffline(): boolean {
	return conduitGlobal[CONDUIT_SLOT] instanceof SerializedConduit;
}

/** Test-only: clear the active conduit so subsequent setConduit calls are clean. */
export function resetConduit(): void {
	conduitGlobal[CONDUIT_SLOT] = null;
}
