/**
 * Calls actuality's steps at the site that served the page. The adapter writes each call's envelope (JSON-RPC with the
 * place in actuality's sequence it acts under), signs it where the step requires authority, sends it with `fetch`, reads a
 * streamed response as NDJSON, and states a failure to reach the site as `ServerUnreachable`. Actuality allocates each act's
 * place. A group begins with `action.begin`, which allocates the group's place, and each of its calls acts under it.
 */
import { z } from "zod";
import { ACTION_BEGIN, readNdjson, type TActualityId, type TRpcEnvelope, ServerUnreachable, answerBody, authorityFailed, refusalCarried } from "@haibun/core/lib/rpc-wire.js";
import type { TProveRequest } from "@haibun/core/lib/transport/ports.js";
import { buildRpcCall } from "@haibun/core/lib/transport/adapters/rpc-call.js";
import type { TConduit } from "../ports.js";
import type { TLink, TRepresentation, TStreamChunk } from "../domains/links.js";

/** What the conduit reads of the page: the proof of a call of a method, the actuality the page reads, how long it waits
 *  for a response, and how it lets go of authority actuality refused. */
export type TConduitSource = { prove(method: string): TProveRequest; actualityId(): TActualityId; responseTimeoutMs(): number; forgetAuthority(): void };

/** What the page holds of its calls, across its bundles: how many calls it numbered, so two calls on the page don't share
 *  an id, when the site last responded, and until when a read fails at once after a timeout. */
export type TConduitHeld = { issued: number; respondedAt: number | undefined; unreachableUntil: number };

/** Returns what a page holds of its calls before its first call. */
export const initialConduitHeld = (): TConduitHeld => ({ issued: 0, respondedAt: undefined, unreachableUntil: 0 });

/** How long after a read timed out each read fails at once. A page sends a read for each view, and each would otherwise wait
 *  out the timeout, where the page reads the device's store. After the interval, the next read is sent. */
export const UNREACHABLE_RETRY_AFTER_MS = 2_000;

/** What actuality returns for `action.begin`: the place in its sequence that a group's calls act under. */
const ActionBeganSchema = z.object({ seqPath: z.array(z.number()).min(1) });

/** The arguments a link's call states: a link without params calls its step without arguments, as an empty record. */
const argumentsOf = (link: TLink): Record<string, unknown> => (link.params === undefined ? {} : link.params);

/** The conduit of a served page. `held` is what the page holds of its calls. `under` is the place a group's calls act under,
 *  and is undefined for the page's own conduit, whose acts actuality places. */
export class LiveConduit implements TConduit {
	constructor(
		private readonly source: TConduitSource,
		private readonly held: TConduitHeld,
		private readonly basePath: string,
		private readonly under: readonly number[] | undefined,
	) {}

	async follow<T = TRepresentation>(link: TLink, _why: string): Promise<T> {
		const res = await this.post(link.method, { method: link.method, params: argumentsOf(link), under: this.underOf(link), asks: link.asks });
		return (await this.answerOf(link.method, res)) as T;
	}

	async followStream(link: TLink, onChunk: (chunk: TStreamChunk) => void, opts: { why: string; signal?: AbortSignal; onStart?: () => void }): Promise<void> {
		opts.onStart?.();
		const res = await this.post(link.method, { method: link.method, params: argumentsOf(link), under: this.underOf(link), stream: true, asks: link.asks }, opts.signal);
		// A refused stream returns its refusal, as any refused call does.
		if (!res.ok) await this.answerOf(link.method, res);
		if (!res.body) throw new Error(`${link.method}: stream RPC didn't return a body`);
		for await (const chunk of readNdjson<TStreamChunk>(res.body)) {
			if (chunk.error) throw new Error(chunk.error);
			onChunk(chunk);
		}
	}

	async group<T>(why: string, fn: (g: TConduit) => Promise<T>): Promise<T> {
		return fn(new LiveConduit(this.source, this.held, this.basePath, await this.beginAction(why)));
	}

	/** The place a call acts under: its group's, for an act. A read doesn't act under a place, since actuality doesn't record a read. */
	private underOf(link: TLink): number[] | undefined {
		return link.asks === "read" || this.under === undefined ? undefined : [...this.under];
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
		// `action.begin` is part of the group: it allocates the place its calls act under.
		const res = await this.post(ACTION_BEGIN, { method: ACTION_BEGIN, params: { why }, asks: "act" });
		return ActionBeganSchema.parse(await this.answerOf(ACTION_BEGIN, res)).seqPath;
	}
}
