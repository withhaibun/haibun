import { errorDetail } from "./util/index.js";
import { readingAt } from "./capability-context.js";
import { rpcEnvelope, readNdjson } from "./rpc-wire.js";

/**
 * rpc-client — capability-scoped client for a haibun host's RPC
 * transport (modules/web-server-hono/sse-transport.ts).
 *
 * Centralises Bearer-token auth, seqPath threading, timeout, retry
 * with backoff, and streaming-NDJSON parsing. Callers that already
 * have a seqPath (feature-step context) pass it; external callers
 * may pass `[]` and the server synthesises a seqPath rooted on its
 * own hostId, matching the MCP dispatch path.
 */

export type RpcClientConfig = {
	/** Base URL of the main host (e.g. "http://localhost:8223"). */
	baseUrl: string;
	/** Bearer token granting the caller's scoped capabilities on the target host. */
	capabilityToken?: string;
	/** Per-call timeout in ms before abort. Default 30_000. */
	timeoutMs?: number;
	/** Retry policy. */
	retry?: {
		maxAttempts?: number;
		baseDelayMs?: number;
	};
	/** Injected for tests. Defaults to global fetch. */
	fetchImpl?: typeof fetch;
};

export type RpcCallOptions = {
	/** Abort signal from the caller. Fires in addition to the per-call timeout. */
	signal?: AbortSignal;
};

export type RpcError = { error: string; [k: string]: unknown };

/**
 * Every RPC call must thread the caller's seqPath so observations on
 * the target host link back to the invoking context (no synthetic
 * `[0, N]` roots). Callers supply either their current feature-step's
 * seqPath or the seqPath of the observation they are acting on.
 */
export class RpcClient {
	private readonly baseUrl: string;
	private readonly capabilityToken?: string;
	private readonly timeoutMs: number;
	private readonly maxAttempts: number;
	private readonly baseDelayMs: number;
	private readonly fetchImpl: typeof fetch;

	constructor(config: RpcClientConfig) {
		this.baseUrl = config.baseUrl.replace(/\/+$/, "");
		this.capabilityToken = config.capabilityToken;
		this.timeoutMs = config.timeoutMs ?? 30_000;
		this.maxAttempts = config.retry?.maxAttempts ?? 3;
		this.baseDelayMs = config.retry?.baseDelayMs ?? 250;
		this.fetchImpl = config.fetchImpl ?? ((...args) => fetch(...args));
	}

	/**
	 * Blocking JSON-RPC call. Returns parsed JSON on success; an RpcError
	 * object (with string `error` field) on HTTP or application error.
	 */
	call<T = unknown>(method: string, params: Record<string, unknown>, seqPath: number[], opts: RpcCallOptions = {}): Promise<T | RpcError> {
		return this.withRetry(async (signal) => {
			const url = `${this.baseUrl}/rpc/${encodeURIComponent(method)}`;
			const res = await this.fetchImpl(url, {
				method: "POST",
				headers: this.buildHeaders(),
				// What this caller may see travels with the call, so a host answers no wider than whoever is reading it:
				// the far side takes the narrower of this and its own ceiling.
				body: rpcEnvelope({ id: `rpc-${Date.now()}`, method, params, seqPath, readingAt: readingAt() }),
				signal,
			});
			const body = (await res.json()) as T | RpcError;
			if (!res.ok) {
				// 422 = application error whose body is surfaced intact.
				if (typeof (body as RpcError).error === "string") return body as RpcError;
				return { error: `HTTP ${res.status}` };
			}
			return body;
		}, opts.signal);
	}

	/**
	 * Streaming JSON-RPC call. Yields chunks as they arrive over NDJSON
	 * (one JSON object per line). Completes when the stream closes.
	 * Consumers may `break` early; the underlying connection is aborted.
	 */
	async *stream<TChunk = unknown>(method: string, params: Record<string, unknown>, seqPath: number[], opts: RpcCallOptions = {}): AsyncGenerator<TChunk, void, unknown> {
		const controller = new AbortController();
		if (opts.signal) {
			if (opts.signal.aborted) controller.abort();
			else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
		}
		const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			const url = `${this.baseUrl}/rpc/${encodeURIComponent(method)}`;
			const res = await this.fetchImpl(url, {
				method: "POST",
				headers: this.buildHeaders(),
				body: rpcEnvelope({ id: `rpc-stream-${Date.now()}`, method, params, seqPath, stream: true, readingAt: readingAt() }),
				signal: controller.signal,
			});
			if (!res.ok || !res.body) {
				const text = res.body ? await res.text().catch(() => "") : "";
				throw new Error(`stream ${method}: HTTP ${res.status}${text ? ` — ${text}` : ""}`);
			}
			yield* readNdjson<TChunk>(res.body);
		} finally {
			clearTimeout(timeoutHandle);
			// If the consumer didn't already abort, do so now to ensure
			// no dangling connection — this is a no-op if already closed.
			controller.abort();
		}
	}

	private buildHeaders(): Record<string, string> {
		const h: Record<string, string> = { "Content-Type": "application/json" };
		if (this.capabilityToken) h.Authorization = `Bearer ${this.capabilityToken}`;
		return h;
	}

	/**
	 * Retry `operation` with exponential backoff + jitter. Returns the
	 * last error as an RpcError when `maxAttempts` is exhausted. Retries
	 * on fetch network errors; does NOT retry on application errors
	 * (RpcError with `error` string) — those are the server's answer.
	 */
	private async withRetry<T>(operation: (signal: AbortSignal) => Promise<T | RpcError>, outerSignal?: AbortSignal): Promise<T | RpcError> {
		let lastErr: unknown;
		for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
			const controller = new AbortController();
			const abortFromOuter = () => controller.abort();
			if (outerSignal) {
				if (outerSignal.aborted) {
					controller.abort();
				} else {
					outerSignal.addEventListener("abort", abortFromOuter, { once: true });
				}
			}
			const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
			try {
				return await operation(controller.signal);
			} catch (err) {
				lastErr = err;
				if (outerSignal?.aborted) throw err;
			} finally {
				clearTimeout(timeout);
				outerSignal?.removeEventListener("abort", abortFromOuter);
			}
			if (attempt + 1 < this.maxAttempts) {
				const backoff = this.baseDelayMs * 2 ** attempt;
				const jitter = Math.floor(Math.random() * this.baseDelayMs);
				await new Promise((r) => setTimeout(r, backoff + jitter));
			}
		}
		return { error: `rpc failed after ${this.maxAttempts} attempts: ${errorDetail(lastErr)}` };
	}
}

/**
 * The instance handshake, shared by every remote surface (federated reads, remote stores): `action.begin`
 * self-reports the peer's hostId and site principal. Fails fast on a peer that predates the site handshake.
 */
export async function discoverInstance(rpc: RpcClient, url: string): Promise<{ hostId: number; site: string }> {
	const result = await rpc.call<{ hostId?: number; site?: string }>("action.begin", {}, []);
	if (typeof (result as { error?: unknown }).error === "string") throw new Error(`discoverInstance: action.begin failed at ${url}: ${(result as { error: string }).error}`);
	const { hostId, site } = result as { hostId?: number; site?: string };
	if (typeof hostId !== "number") throw new Error(`discoverInstance: ${url} did not report a hostId`);
	if (typeof site !== "string" || site.length === 0) throw new Error(`discoverInstance: ${url} did not report a site principal — the peer predates federation`);
	return { hostId, site };
}

