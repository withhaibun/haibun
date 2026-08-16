import { EventEmitter } from "events";
import { stream } from "hono/streaming";
import { streamSSE } from "hono/streaming";
import type { IWebServer } from "./defs.js";
import type { IEventLogger } from "@haibun/core/lib/EventLogger.js";
import { truncateForLog, errorDetail } from "@haibun/core/lib/util/index.js";
import type { StepRegistry } from "@haibun/core/lib/step-registry.js";
import { streamContext, type TStreamChunk } from "@haibun/core/lib/step-stream-context.js";
import type { IStepTransport } from "./step-transport.js";

export type TTransportRequestInfo = {
	headers?: Record<string, string | undefined>;
	/** What the request asks, and of what: a presentation signed over the request covers both. */
	method?: string;
	url?: string;
};

type TMessageHandler = (data: unknown, requestInfo?: TTransportRequestInfo) => unknown | Promise<unknown>;

export interface ITransport {
	send(data: unknown): void;
	onMessage(handler: TMessageHandler): void;
}

export const TRANSPORT = "transport";

export class SSETransport implements ITransport, IStepTransport {
	readonly name = "SSETransport";
	private hub = new EventEmitter();
	public webserver: IWebServer;
	private eventLogger: IEventLogger;
	private messageHandlers: TMessageHandler[] = [];
	private history: string[] = [];

	constructor(webserver: IWebServer, eventLogger: IEventLogger) {
		this.webserver = webserver;
		this.eventLogger = eventLogger;
		this.setupRoutes();
	}

	private setupRoutes(): void {
		this.webserver.addRoute("get", "/sse", { description: "Server-Sent Events stream for live framework events" }, async (c) => {
			this.eventLogger.debug("SSE Client connected");
			return await streamSSE(c, async (sseStream) => {
				// Replay history under its own SSE event name: a replayed event is a fact about the past, not a live
				// occurrence, and every (re)connecting client receives the whole history — the client must be able to
				// tell the two apart (e.g. a closed view must not be resurrected by a reconnect's replay).
				for (const msg of this.history) {
					await sseStream.writeSSE({
						data: msg,
						event: "replay",
					});
				}

				const handler = (data: string) => {
					sseStream.writeSSE({ data, event: "message" }).catch((e) => {
						this.eventLogger.error(`Error writing to SSE stream: ${e}`);
					});
				};
				this.hub.on("event", handler);

				sseStream.onAbort(() => {
					this.eventLogger.debug("SSE Client disconnected");
					this.hub.off("event", handler);
				});

				// Keep connection open
				while (true) {
					await sseStream.sleep(1000);
				}
			});
		});

		this.webserver.addRoute("post", "/rpc/:_method", { description: "JSON-RPC dispatch for stepper methods" }, async (c) => {
			let data: unknown;
			try {
				data = await c.req.json();
			} catch (e) {
				this.eventLogger.error(`Error parsing RPC POST message: ${e}`);
				return c.json({ ok: false, error: String(e) }, 400);
			}
			const requestInfo: TTransportRequestInfo = { headers: c.req.header(), method: c.req.method, url: c.req.url };
			const isStream = (data as Record<string, unknown>).stream === true;

			// Streaming requests open an NDJSON response and run the same dispatcher inside `streamContext`. Step actions read the per-request emit callback from AsyncLocalStorage and push chunks during execution; the final dispatchStep result (success or refusal) lands on the seqPath via stepStart/stepEnd lifecycle events. No dual handler path — one dispatcher, one error contract.
			if (isStream) {
				c.header("Content-Type", "application/x-ndjson");
				return stream(c, async (s) => {
					const abortController = new AbortController();
					s.onAbort(() => abortController.abort());
					const writeChunk = async (chunk: TStreamChunk | Record<string, unknown>) => {
						await s.write(new TextEncoder().encode(JSON.stringify(chunk) + "\n"));
					};
					const emit = (chunk: TStreamChunk) => {
						// Fire-and-forget: NDJSON write order is preserved by hono's stream; awaiting from a synchronous callback would force the action to be aware of backpressure, which is a leaky abstraction.
						void writeChunk(chunk);
					};
					await streamContext.run({ emit, signal: abortController.signal }, async () => {
						const result = await this.handleMessage(data, requestInfo);
						if (result === undefined) {
							const method = (data as Record<string, unknown>).method ?? "unknown";
							await writeChunk({ error: `No handler for RPC method: ${method}` });
							return;
						}
						const response = result as Record<string, unknown>;
						// Successful dispatch already pushed its content via streamContext.emit; emitting the products again would duplicate the stream. On refusal, emit the error as a terminating record so the client surfaces it. The lifecycle stepEnd event already fired on the seqPath via dispatchStep — seq-bound consumers see the canonical record there.
						if (response.error) await writeChunk({ error: response.error });
					});
				});
			}

			this.eventLogger.debug(`RPC: ${JSON.stringify(truncateForLog(data))}`);
			const result = await this.handleMessage(data, requestInfo);
			if (result === undefined) {
				const method = (data as Record<string, unknown>).method ?? "unknown";
				return c.json({ ok: false, error: `No handler for RPC method: ${method}` }, 404);
			}
			const response = result as Record<string, unknown>;
			const status = response.error ? 422 : 200;
			try {
				return c.json(response, status);
			} catch (serializeErr) {
				// V8 raises RangeError when JSON.stringify is asked for a string longer than ~512MB. Return a structured error instead of letting the unhandled throw stall the client's fetch.
				const method = (data as Record<string, unknown>).method ?? "unknown";
				const reason = errorDetail(serializeErr);
				this.eventLogger.error(`RPC ${method} response too large to serialize: ${reason}`);
				return c.json({ ok: false, error: `${method}: response too large to serialize (${reason}). Narrow the query or return a summary.` }, 413);
			}
		});
	}

	// biome-ignore lint/suspicious/noExplicitAny: event payload
	public send(data: any) {
		if (data?.type === "init") {
			this.history = [];
		}
		let payload: string;
		try {
			payload = JSON.stringify(data);
		} catch (err) {
			// Payload too large to serialize (V8 raises RangeError around 512MB) or
			// otherwise unstringifiable. Emit a replacement event so the SSE stream
			// stays alive — losing one oversized broadcast is acceptable; losing
			// every subsequent event because the transport silently throws is not.
			const fallback = {
				id: data?.id,
				timestamp: data?.timestamp,
				kind: data?.kind,
				type: data?.type,
				stage: data?.stage,
				status: data?.status,
				level: data?.level,
				dropped: true,
				droppedReason: errorDetail(err),
			};
			payload = JSON.stringify(fallback);
			this.eventLogger.error(`SSE event dropped (payload too large to serialize): ${fallback.droppedReason}`);
		}
		this.history.push(payload);
		this.hub.emit("event", payload);
	}

	public onMessage(handler: TMessageHandler) {
		this.messageHandlers.push(handler);
	}

	/** IStepTransport: register the step registry (routes already set up at construction). */
	attach(_registry: StepRegistry, _webserver: IWebServer): void {
		// Routes set up in constructor; registry is provided via WebServerStepper's enableRpc step
	}

	/** IStepTransport: clear handlers on teardown. */
	detach(): void {
		this.messageHandlers = [];
	}

	private async handleMessage(data: unknown, requestInfo?: TTransportRequestInfo): Promise<unknown> {
		for (const handler of this.messageHandlers) {
			const result = await handler(data, requestInfo);
			if (result !== undefined) return result;
		}
		return undefined;
	}
}
