/**
 * rpc-client — capability-scoped client for the main haibun host's
 * RPC transport (modules/web-server-hono/sse-transport.ts).
 *
 * Why a client: the autonomic module has 3–4 RPC call sites with
 * overlapping needs — Bearer-token auth on every request, seqPath
 * threading (per commit 5's integrity rule), timeout, retry with
 * backoff, and streaming-NDJSON parsing for large responses. Having
 * each caller reimplement that grows subtle bugs; a single client
 * centralises the transport concerns.
 *
 * Two methods:
 *   call(method, params, seqPath)    — blocking JSON-RPC
 *   stream(method, params, seqPath)  — async iterable of NDJSON chunks
 *
 * The autonomic module owns a scoped capability token — typically
 * `Autonomic:read` initially, growing to `Autonomic:comment`,
 * `Autonomic:suggest`, and eventually `Autonomic:apply:<tunable>` as
 * operators opt in. Every request carries the token as a Bearer header;
 * the main host's authorizeToolCapability guards dispatch-time.
 */

export type RpcClientConfig = {
	/** Base URL of the main host (e.g. "http://localhost:8223"). */
	baseUrl: string;
	/** Bearer token granting the autonomic process its scoped capabilities. */
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
 * Every RPC call must thread the caller's seqPath (per commit 5's
 * seqPath-integrity rule). The autonomic module always has a seqPath
 * context — either its own cycle's seqPath, or the seqPath of the
 * observation it's acting on.
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
	call<T = unknown>(
		method: string,
		params: Record<string, unknown>,
		seqPath: number[],
		opts: RpcCallOptions = {},
	): Promise<T | RpcError> {
		return this.withRetry(async (signal) => {
			const url = `${this.baseUrl}/rpc/${encodeURIComponent(method)}`;
			const res = await this.fetchImpl(url, {
				method: "POST",
				headers: this.buildHeaders(),
				body: JSON.stringify({ jsonrpc: "2.0", id: `rpc-${Date.now()}`, method, params, seqPath }),
				signal,
			});
			const body = (await res.json()) as T | RpcError;
			if (!res.ok) {
				// 422 = application error with a body we want to surface intact.
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
	async *stream<TChunk = unknown>(
		method: string,
		params: Record<string, unknown>,
		seqPath: number[],
		opts: RpcCallOptions = {},
	): AsyncGenerator<TChunk, void, unknown> {
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
				body: JSON.stringify({ jsonrpc: "2.0", id: `rpc-stream-${Date.now()}`, method, params, seqPath, stream: true }),
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
	private async withRetry<T>(
		operation: (signal: AbortSignal) => Promise<T | RpcError>,
		outerSignal?: AbortSignal,
	): Promise<T | RpcError> {
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
		return { error: `rpc failed after ${this.maxAttempts} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}` };
	}
}

/**
 * Parse an NDJSON response body — one JSON object per line. Tolerates
 * partial lines across chunks. Stops on stream end.
 */
async function* readNdjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T, void, unknown> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let idx = buffer.indexOf("\n");
			while (idx !== -1) {
				const line = buffer.slice(0, idx).trim();
				buffer = buffer.slice(idx + 1);
				if (line.length > 0) {
					try {
						yield JSON.parse(line) as T;
					} catch {
						// Malformed chunk — skip rather than crash the stream.
					}
				}
				idx = buffer.indexOf("\n");
			}
		}
		// Flush any remaining buffered content (final line without trailing newline).
		const tail = buffer.trim();
		if (tail.length > 0) {
			try {
				yield JSON.parse(tail) as T;
			} catch {
				/* ignore trailing malformed content */
			}
		}
	} finally {
		try {
			await reader.cancel();
		} catch {
			/* reader already closed */
		}
	}
}
