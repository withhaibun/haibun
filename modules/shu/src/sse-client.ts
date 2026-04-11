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

// --- Shared SSE connection (one per page) ---

let sseSource: EventSource | null = null;
let sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;
const sseListeners: { handler: TEventHandler; filter?: TEventFilter }[] = [];
const clientId = `sse-${Math.random().toString(36).slice(2, 8)}`;

function dispatchSseEvent(event: Record<string, unknown>): void {
	for (const listener of sseListeners) {
		try {
			if (!listener.filter || listener.filter(event)) {
				listener.handler(event);
			}
		} catch (e) {
			console.error(`[sse:${clientId}] listener error:`, e);
		}
	}
}

function connectSSE(): void {
	if (sseSource) {
		console.warn(`[sse:${clientId}] duplicate connectSSE() call — already connected (readyState=${sseSource.readyState})`);
		return;
	}

	sseSource = new EventSource("/sse");

	sseSource.onmessage = (sseEvent) => {
		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(sseEvent.data);
		} catch (e) {
			console.warn(`[sse:${clientId}] malformed message:`, sseEvent.data, e);
			return;
		}
		if (msg.type === "event" && msg.event) {
			dispatchSseEvent(msg.event as Record<string, unknown>);
		}
	};

	sseSource.onerror = (e) => {
		const state = sseSource?.readyState;
		console.warn(`[sse:${clientId}] connection error (readyState=${state})`, e);
		sseSource?.close();
		sseSource = null;

		if (!sseReconnectTimer) {
			sseReconnectTimer = setTimeout(() => {
				sseReconnectTimer = null;
				connectSSE();
			}, 2000);
		}
	};
}

function ensureSSE(): void {
	if (!sseSource && !sseReconnectTimer) {
		connectSSE();
	}
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
	async rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		const key = cacheKey(method, params);
		if (ShuElement.offline) {
			// Exact match first, then method-only match (server caches without params)
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
	async rpcStream(method: string, params: Record<string, unknown>, onChunk: (data: unknown) => void, signal?: AbortSignal): Promise<void> {
		const id = nextId();
		const res = await fetch(`${this.basePath}/rpc/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id,
				method,
				params,
				stream: true,
			}),
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
		const entry = { handler, filter };
		sseListeners.push(entry);
		return () => {
			const idx = sseListeners.indexOf(entry);
			if (idx >= 0) sseListeners.splice(idx, 1);
		};
	}

	/** Close the shared SSE connection. */
	close(): void {
		if (sseReconnectTimer) {
			clearTimeout(sseReconnectTimer);
			sseReconnectTimer = null;
		}
		sseSource?.close();
		sseSource = null;
		instances.delete(this.basePath);
	}
}
