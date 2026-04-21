/**
 * RPC client for stepper step endpoints.
 * Regular RPC: POST → JSON response.
 * Streaming RPC: POST with stream:true → NDJSON response stream.
 * Server events: SSE (for lifecycle/log events).
 *
 * SSE uses a single shared connection regardless of basePath.
 * basePath only affects RPC call routing.
 */

import { ShuElement } from "./components/shu-element.js";
import { cacheKey, cacheGet, cacheSet, cacheHas } from "./rpc-cache.js";

export type TEventFilter = (event: Record<string, unknown>) => boolean;
type TEventHandler = (event: Record<string, unknown>) => void;

/** Error thrown when an RPC method has no cached response in offline mode. */
export class OfflineError extends Error {
	constructor(method: string) {
		super(`This query was not captured during the test session (${method})`);
		this.name = "OfflineError";
	}
}

let counter = 0;
function nextId(): string {
	return `rpc-${++counter}-${Date.now().toString(36)}`;
}

/**
 * SPA callers have no haibun feature-step seqPath to thread. The server
 * allocates one on demand via `session.beginAction`, returning a
 * globally-unique root that the client extends with monotonic sub-seqs
 * for every RPC within the action scope. The SPA never invents its own
 * seqPath, so collisions across page reloads or multiple tabs are
 * impossible by construction.
 *
 * Type guardrail: `ActionScope` is a branded opaque token constructed
 * only by `inAction`. `rpc` / `rpcStream` require it as their first
 * argument, so a caller cannot issue an RPC without entering an action.
 * Introspection-only methods (`step.list`, `step.validate`,
 * `session.beginAction` itself) bypass this via `rpcOpen`.
 */

/** Branded opaque token — only `inAction` constructs this. */
export type ActionScope = {
	readonly __brand: "ActionScope";
	readonly root: readonly number[];
	/** Mutable sub-sequence counter; each RPC within the scope increments and appends. */
	subSeq: number;
};

function makeScope(root: readonly number[]): ActionScope {
	return { __brand: "ActionScope", root, subSeq: 0 } as ActionScope;
}

function nextScopeSeqPath(scope: ActionScope): number[] {
	scope.subSeq += 1;
	return [...scope.root, scope.subSeq];
}

/**
 * Enter an action scope: asks the server to allocate a seqPath root,
 * then runs `fn` with a scope that extends that root for every RPC.
 * Nested `inAction` calls reuse the outer scope (flattened) so
 * programmatic composition doesn't deepen the path unnecessarily.
 */
let currentScope: ActionScope | undefined;

export async function inAction<T>(fn: (scope: ActionScope) => Promise<T>): Promise<T> {
	if (currentScope) return fn(currentScope);
	const { seqPath } = await SseClient.for("").rpcOpen<{ seqPath: number[] }>("session.beginAction", {});
	if (!Array.isArray(seqPath) || seqPath.length === 0) {
		throw new Error("session.beginAction returned no seqPath");
	}
	const scope = makeScope(seqPath);
	currentScope = scope;
	try {
		return await fn(scope);
	} finally {
		currentScope = undefined;
	}
}

// --- Shared SSE connection (one per page) ---

import { SseSubscriber } from "@haibun/core/lib/sse-subscriber.js";

let sharedSubscriber: SseSubscriber | null = null;

function ensureSSE(): SseSubscriber {
	if (!sharedSubscriber) {
		sharedSubscriber = new SseSubscriber({ url: "/sse" });
		sharedSubscriber.connect();
	}
	return sharedSubscriber;
}

// --- RPC client instances (keyed by basePath for routing) ---

const instances = new Map<string, SseClient>();

export class SseClient {
	private constructor(private basePath: string) {}

	/** Get or create a singleton SseClient for the given basePath.
	 * In standalone mode (file:// with embedded data), returns a no-op client. */
	static for(basePath: string): SseClient {
		if (!ShuElement.offline) ensureSSE();
		let client = instances.get(basePath);
		if (!client) {
			client = new SseClient(basePath);
			instances.set(basePath, client);
		}
		return client;
	}

	/** Single request/response RPC call. In offline mode, returns cached response or throws OfflineError. */
	async rpc<T = unknown>(scope: ActionScope, method: string, params: Record<string, unknown> = {}): Promise<T> {
		const key = cacheKey(method, params);
		if (ShuElement.offline) {
			if (cacheHas(key)) return cacheGet(key) as T;
			if (cacheHas(method)) return cacheGet(method) as T;
			throw new OfflineError(method);
		}
		const id = nextId();
		const res = await fetch(`${this.basePath}/rpc/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id, method, params, seqPath: nextScopeSeqPath(scope) }),
		});
		const data = await res.json();
		if (!res.ok || data.error) throw new Error(data.error || `RPC failed: ${res.status}`);
		cacheSet(key, data);
		return data as T;
	}

	/**
	 * Open RPC: for introspection / session-bootstrap methods that produce
	 * no observations and cannot require a seqPath (including
	 * `session.beginAction` itself). Server enforces the allowlist.
	 */
	async rpcOpen<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		const key = cacheKey(method, params);
		if (ShuElement.offline) {
			if (cacheHas(key)) return cacheGet(key) as T;
			if (cacheHas(method)) return cacheGet(method) as T;
			throw new OfflineError(method);
		}
		const id = nextId();
		const res = await fetch(`${this.basePath}/rpc/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
		});
		const data = await res.json();
		if (!res.ok || data.error) throw new Error(data.error || `RPC failed: ${res.status}`);
		cacheSet(key, data);
		return data as T;
	}

	/** Streaming RPC call. Throws in standalone mode (no server). */
	async rpcStream(scope: ActionScope, method: string, params: Record<string, unknown>, onChunk: (data: unknown) => void, signal?: AbortSignal): Promise<void> {
		const id = nextId();
		const res = await fetch(`${this.basePath}/rpc/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id, method, params, seqPath: nextScopeSeqPath(scope), stream: true }),
			signal,
		});
		if (!res.ok) throw new Error(`RPC stream failed: ${res.status}`);
		if (!res.body) throw new Error("No response body for stream");

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
				const chunk = JSON.parse(line);
				if (chunk.error) throw new Error(String(chunk.error));
				onChunk(chunk);
			}
		}
		if (buffer.trim()) {
			const chunk = JSON.parse(buffer);
			if (chunk.error) throw new Error(String(chunk.error));
			onChunk(chunk);
		}
	}

	/**
	 * Subscribe to server-pushed events with optional filtering.
	 * Returns an unsubscribe function.
	 */
	onEvent(handler: TEventHandler, filter?: TEventFilter): () => void {
		return ensureSSE().subscribe(handler, filter);
	}

	/** Close the shared SSE connection. */
	close(): void {
		sharedSubscriber?.close();
		sharedSubscriber = null;
		instances.delete(this.basePath);
	}
}
