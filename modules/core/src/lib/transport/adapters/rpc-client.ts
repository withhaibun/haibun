import { stripTrailingSlash } from "../../local-origin.js";
import { errorDetail } from "../../util/index.js";
import { readingAt } from "../../capability-context.js";
import { provesNothing, readNdjson, readRpcAnswer, type TActualityId, type THandshake, type TProveRequest } from "../ports.js";
import { buildRpcCall, handshakeAt } from "./rpc-call.js";
import type { TRequestSigner } from "../../domains/authority-types.js";

/**
 * rpc-client is the client for a haibun host's RPC transport (web-server-hono's event stream adapter).
 *
 * It centralises signed invocation, seqPath threading, timeouts, retry with backoff and streaming NDJSON parsing. A call
 * that invokes an action is signed over the request it sends. A call that doesn't invoke one is sent unsigned. A caller
 * in a feature-step context passes its seqPath. An external caller may pass `[]`, and the server then synthesises a
 * seqPath rooted at its own hostId, as the MCP dispatch path does.
 */

type RpcClientConfig = {
	/** Base URL of the main host (e.g. "http://localhost:8223"). */
	baseUrl: string;
	/** Signs a call that invokes an action with the authority this process holds at the host. */
	sign?: TRequestSigner;
	/** How long a call waits, in ms, before it aborts. A client that doesn't state it waits `CALL_TIMEOUT_MS`. */
	timeoutMs?: number;
	/** How often a call is sent, and the delay before the first retry. A client that doesn't state them sends a call
	 *  `CALL_ATTEMPTS` times, `RETRY_DELAY_MS` apart at first. */
	retry?: { maxAttempts?: number; baseDelayMs?: number };
	/** The fetch a call is sent through, such as a test's. A client that doesn't state it sends through the global fetch. */
	fetchImpl?: typeof fetch;
};

/** How long a call waits before it aborts, where its client doesn't state it. */
const CALL_TIMEOUT_MS = 30_000;
/** How often a call is sent, where its client doesn't state it. */
const CALL_ATTEMPTS = 3;
/** The delay before a call's first retry, where its client doesn't state it; each later retry waits twice as long. */
const RETRY_DELAY_MS = 250;

type RpcCallOptions = {
	/** Abort signal from the caller. Fires in addition to the per-call timeout. */
	signal?: AbortSignal;
	/** The action the call invokes at the host. The call's signature names it. A call that doesn't name an action isn't signed. */
	action?: string;
};

/** The reason a call failed and whether the host returned that reason. A reason the host returned names the method it
 *  refused. A failure without a response doesn't name the method. */
type RpcError = { error: string; answered: boolean };

/** A call that another instance refused or that didn't reach the instance after every attempt. `answered` is true when
 *  the instance returned the reason, which names the method. A reason the instance didn't return doesn't name the method
 *  or the host, so the message states both. */
export class RpcCallFailed extends Error {
	constructor(
		readonly method: string,
		readonly url: string,
		readonly reason: string,
		readonly answered: boolean,
	) {
		super(`${method} at ${url}: ${reason}`);
	}
}

/**
 * Every RPC call carries the caller's seqPath, so observations on the target host link back to the invoking context
 * without synthetic `[0, N]` roots. A caller passes its current feature step's seqPath, or the seqPath of the observation
 * that its call acts upon.
 */
export class RpcClient {
	private readonly baseUrl: string;
	private readonly sign?: TRequestSigner;
	private readonly timeoutMs: number;
	private readonly maxAttempts: number;
	private readonly baseDelayMs: number;
	private readonly fetchImpl?: typeof fetch;
	private actuality?: Promise<TActualityId>;

	constructor(config: RpcClientConfig) {
		this.baseUrl = stripTrailingSlash(config.baseUrl);
		this.sign = config.sign;
		const { timeoutMs, retry, fetchImpl } = config;
		this.timeoutMs = timeoutMs === undefined ? CALL_TIMEOUT_MS : timeoutMs;
		this.maxAttempts = retry?.maxAttempts === undefined ? CALL_ATTEMPTS : retry.maxAttempts;
		this.baseDelayMs = retry?.baseDelayMs === undefined ? RETRY_DELAY_MS : retry.baseDelayMs;
		this.fetchImpl = fetchImpl;
	}

	/** Sends a request through the fetch this client was given, or through the global fetch where it wasn't given one. */
	private readonly send: typeof fetch = (input, init) => (this.fetchImpl === undefined ? fetch(input, init) : this.fetchImpl(input, init));

	/** Sends a non-streaming JSON-RPC call and returns the instance's result. A call that the instance refuses or that
	 *  doesn't reach it after every attempt throws `RpcCallFailed`. */
	async call<T = unknown>(method: string, params: Record<string, unknown>, seqPath: number[], opts?: RpcCallOptions): Promise<T> {
		// The envelope carries this caller's read ceiling (`readingAt`), so the host doesn't respond wider than the reader may
		// see. The host reads at the narrower of this ceiling and its own. The call is signed once before the first send. A
		// signing refusal comes from this process and isn't a network fault, so only the send is retried.
		const envelope = { id: `rpc-${Date.now()}`, method, params, seqPath, readingAt: readingAt(), actualityId: await this.actualityId() };
		const call = await buildRpcCall(this.baseUrl, envelope, this.proving(opts?.action));
		const outcome = await this.withRetry(async (signal): Promise<{ answered: T } | RpcError> => {
			const res = await this.send(call.url, { ...call.init, signal });
			const answer = await readRpcAnswer(method, res);
			return answer.kind === "answered" ? { answered: answer.body as T } : { error: answer.error, answered: true };
		}, opts?.signal);
		if ("error" in outcome) throw new RpcCallFailed(method, this.baseUrl, outcome.error, outcome.answered);
		return outcome.answered;
	}

	/** Performs the instance's handshake and returns its hostId, site principal and actualityId. Every later call states that actualityId. */
	async handshake(): Promise<THandshake> {
		const answered = await handshakeAt(this.baseUrl, this.send);
		this.actuality = Promise.resolve(answered.actualityId);
		return answered;
	}

	/** Returns the actualityId this client's calls state. It reads the instance's last handshake and performs a handshake
	 *  when one hasn't completed. A failed handshake clears it, so the next call performs another. */
	private actualityId(): Promise<TActualityId> {
		this.actuality ??= this.handshake().then(
			({ actualityId }) => actualityId,
			(err: unknown) => {
				this.actuality = undefined;
				throw err;
			},
		);
		return this.actuality;
	}

	/**
	 * Sends a streaming JSON-RPC call. Yields each chunk as it arrives over NDJSON, one JSON object per line. Completes
	 * when the stream closes. A consumer may `break` early, and the connection is then aborted.
	 */
	async *stream<TChunk = unknown>(method: string, params: Record<string, unknown>, seqPath: number[], opts?: RpcCallOptions): AsyncGenerator<TChunk, void, unknown> {
		const prove = this.proving(opts?.action);
		const controller = new AbortController();
		const outer = opts?.signal;
		if (outer) {
			if (outer.aborted) controller.abort();
			else outer.addEventListener("abort", () => controller.abort(), { once: true });
		}
		const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			const call = await buildRpcCall(
				this.baseUrl,
				{ id: `rpc-stream-${Date.now()}`, method, params, seqPath, stream: true, readingAt: readingAt(), actualityId: await this.actualityId() },
				prove,
			);
			const res = await this.send(call.url, { ...call.init, signal: controller.signal });
			if (!res.ok || !res.body) {
				const text = res.body ? await res.text().catch((unread: unknown) => `its body didn't read: ${errorDetail(unread)}`) : "";
				throw new Error(`stream ${method}: HTTP ${res.status}${text ? `, ${text}` : ""}`);
			}
			yield* readNdjson<TChunk>(res.body);
		} finally {
			clearTimeout(timeoutHandle);
			// Abort the connection so it doesn't stay open after the consumer stops. An abort after close doesn't have an effect.
			controller.abort();
		}
	}

	/** Returns how a call invoking `action` is proven. A client without a signer refuses such a call because the host
	 *  would refuse it unsigned. */
	private proving(action: string | undefined): TProveRequest {
		if (!action) return provesNothing;
		const sign = this.sign;
		if (!sign) throw new Error(`rpc ${this.baseUrl}: a call invoking ${action} must be signed, and this client doesn't hold a signer. Pass sign to RpcClient.`);
		return (request) => sign(request, action);
	}

	/**
	 * Retries `operation` with exponential backoff and jitter. Returns the last error as an RpcError when `maxAttempts` is
	 * exhausted. A thrown fetch network error is retried. A returned RpcError with an `error` string isn't retried, because
	 * it is the server's response.
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
		return { error: `rpc failed after ${this.maxAttempts} attempts: ${errorDetail(lastErr)}`, answered: false };
	}
}

/** A connection to another instance. It holds the client that signs each call to the instance and the site principal
 *  the instance reports when the connection is made. Reading `site` before `connect` completes throws. */
export class RemoteInstance {
	readonly rpc: RpcClient;
	private reported?: string;

	constructor(
		readonly url: string,
		sign: TRequestSigner,
		fetchImpl?: typeof fetch,
	) {
		this.rpc = new RpcClient({ baseUrl: url, sign, fetchImpl });
	}

	/** Performs the handshake and returns the site principal the instance reports. Calls through this connection address that site. */
	async connect(): Promise<string> {
		this.reported = (await this.rpc.handshake()).site;
		return this.reported;
	}

	get site(): string {
		if (!this.reported) throw new Error(`the connection to ${this.url} hasn't completed its handshake, so it doesn't hold the site's principal. Call connect() first.`);
		return this.reported;
	}
}
