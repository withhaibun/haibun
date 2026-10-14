/**
 * Calls actuality's steps at the site that served the page. The adapter writes each call's envelope (JSON-RPC with the
 * place in actuality's sequence), signs it where the step requires authority, sends it with `fetch`, reads a streamed
 * response as NDJSON, and states a failure to reach the site as `ServerUnreachable`. An act begins with `action.begin`,
 * which allocates its place in actuality's sequence, and a group's calls each take a part of the group's place.
 */
import { z } from "zod";
import {
	ACTION_BEGIN,
	readNdjson,
	type TProveRequest,
	type TActualityId,
	type TRpcEnvelope,
	ServerUnreachable,
	answerBody,
	authorityFailed,
	refusalCarried,
} from "@haibun/core/lib/rpc-wire.js";
import { buildRpcCall } from "@haibun/core/lib/transport/adapters/rpc-call.js";
import type { TConduit } from "../ports.js";
import type { TLink, TRepresentation, TStreamChunk } from "../domains/links.js";

/** What the conduit reads of the page: the proof of a call of a method, the actuality the page reads, how long it waits
 *  for a response, and how it lets go of authority actuality refused. */
export type TConduitSource = { prove(method: string): TProveRequest; actualityId(): TActualityId; responseTimeoutMs(): number; forgetAuthority(): void };

type ActionScope = { readonly root: readonly number[]; subSeq: number };

/** What the page holds of its calls, across its bundles: how many calls it numbered, so two calls on the page don't share
 *  an id, when the site last responded, and until when a read fails at once after a timeout. */
export type TConduitHeld = { issued: number; respondedAt: number | undefined; unreachableUntil: number };

/** Returns what a page holds of its calls before its first call. */
export const initialConduitHeld = (): TConduitHeld => ({ issued: 0, respondedAt: undefined, unreachableUntil: 0 });

/** How long after a read timed out each read fails at once. A page sends a read for each view, and each would otherwise wait
 *  out the timeout, where the page reads the device's store. After the interval, the next read is sent. */
export const UNREACHABLE_RETRY_AFTER_MS = 2_000;

/** What actuality returns for `action.begin`: the place in its sequence that records the act. */
const ActionBeganSchema = z.object({ seqPath: z.array(z.number()).min(1) });

/** The conduit of a served page. `held` is what the page holds of its calls. `scope` is the place a group's calls share, and
 *  is null for the page's own conduit, which allocates a place for each act. */
/** The arguments a link's call states: a link without params calls its step without arguments, as an empty record. */
const argumentsOf = (link: TLink): Record<string, unknown> => (link.params === undefined ? {} : link.params);

export class LiveConduit implements TConduit {
	constructor(
		private readonly source: TConduitSource,
		private readonly held: TConduitHeld,
		private readonly basePath: string,
		private readonly scope: ActionScope | null,
	) {}

	async follow<T = TRepresentation>(link: TLink, why: string): Promise<T> {
		// A read doesn't begin an act, since actuality doesn't record a read and an act's place takes a call of its own. An
		// act begins one, since actuality records what the act does at that place.
		const seqPath = link.asks === "read" ? undefined : await this.allocateSeqPath(why);
		const res = await this.post(link.method, { method: link.method, params: argumentsOf(link), seqPath, asks: link.asks });
		return (await this.answerOf(link.method, res)) as T;
	}

	async followStream(
		link: TLink,
		onChunk: (chunk: TStreamChunk) => void,
		opts: { why: string; signal?: AbortSignal; onStart?: (seqPath: number[]) => void },
	): Promise<{ seqPath: number[] }> {
		const seqPath = await this.allocateSeqPath(opts.why);
		opts.onStart?.(seqPath);
		const res = await this.post(link.method, { method: link.method, params: argumentsOf(link), seqPath, stream: true, asks: link.asks }, opts.signal);
		// A refused stream returns its refusal, as any refused call does.
		if (!res.ok) await this.answerOf(link.method, res);
		if (!res.body) throw new Error(`${link.method}: stream RPC didn't return a body`);
		for await (const chunk of readNdjson<TStreamChunk>(res.body)) {
			if (chunk.error) throw new Error(chunk.error);
			onChunk(chunk);
		}
		return { seqPath };
	}

	async group<T>(why: string, fn: (g: TConduit) => Promise<T>): Promise<T> {
		const root = await this.beginAction(why);
		return fn(new LiveConduit(this.source, this.held, this.basePath, { root, subSeq: 0 }));
	}

	private allocateSeqPath(why: string): Promise<number[]> {
		if (this.scope) {
			this.scope.subSeq += 1;
			return Promise.resolve([...this.scope.root, this.scope.subSeq]);
		}
		return this.beginAction(why);
	}

	// Writes every request: the envelope, the headers (signed where the step requires authority) and the POST.
	private async post(method: string, envelope: Omit<TRpcEnvelope, "id" | "actualityId">, signal?: AbortSignal): Promise<Response> {
		// The proof covers the absolute address of the request. A proof over a relative path doesn't state the destination,
		// and the host checks the absolute address it receives.
		const base = new URL(`${this.basePath}/`, location.origin).href;
		// A host that receives a request and doesn't respond looks the same as an unreachable host, so a request the page
		// waits on carries a timeout. A request with the caller's own signal, and a stream, which stays open while actuality
		// writes to it, don't carry the timeout.
		const awaited = signal === undefined && envelope.stream !== true;
		// Within the retry interval of a timed-out read, a read fails at once with that timeout. Each of a page's views would
		// otherwise wait out the timeout separately. An act is sent regardless, since a reader requested it. The timer is
		// allocated after this check, so a read that isn't sent doesn't allocate one.
		if (awaited && envelope.asks !== "act" && Date.now() < this.held.unreachableUntil)
			throw new ServerUnreachable(base, new Error("a read of this server timed out within the last interval"));
		const call = await buildRpcCall(base, { ...envelope, id: this.nextRpcId(), actualityId: this.source.actualityId() }, this.source.prove(method));
		const bounded = awaited ? AbortSignal.timeout(this.source.responseTimeoutMs()) : signal;
		try {
			const res = await fetch(call.url, { ...call.init, signal: bounded });
			// The timeout bounds the whole response, so an awaited request's body is read here, where a body still arriving at
			// the timeout fails as a failure to reach the host.
			const answered = awaited ? new Response(await res.arrayBuffer(), { status: res.status, statusText: res.statusText, headers: res.headers }) : res;
			this.held.respondedAt = Date.now();
			this.held.unreachableUntil = 0;
			return answered;
		} catch (err) {
			// The caller stopped the request, so the failure doesn't state whether the host is reachable.
			if (signal?.aborted) throw err;
			// Only a timeout withholds later reads. A request the network refuses fails at once, so the next read doesn't delay
			// the page, and that read finds a host that recovered.
			if (bounded?.aborted) this.held.unreachableUntil = Date.now() + UNREACHABLE_RETRY_AFTER_MS;
			throw new ServerUnreachable(call.url, err);
		}
	}

	/** Returns actuality's response to a call, or throws the refusal it states. Authority that actuality refused as failing
	 *  verification, as revoked or lapsed authority is, is let go, so later calls are made without it. */
	private async answerOf(method: string, res: Response): Promise<unknown> {
		try {
			return await answerBody(method, res);
		} catch (err) {
			if (authorityFailed(refusalCarried(err))) this.source.forgetAuthority();
			throw err;
		}
	}

	private nextRpcId(): string {
		this.held.issued += 1;
		return `rpc-${this.held.issued}-${Date.now().toString(36)}`;
	}

	private async beginAction(why: string): Promise<number[]> {
		// `action.begin` is part of the act: it allocates the act's place in actuality's sequence.
		const res = await this.post(ACTION_BEGIN, { method: ACTION_BEGIN, params: { why }, asks: "act" });
		return ActionBeganSchema.parse(await this.answerOf(ACTION_BEGIN, res)).seqPath;
	}
}
