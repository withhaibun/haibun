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
	/** The body exactly as it arrived. A signature covers a digest of these bytes, and what the request asks is read
	 *  out of them, so the two are the same bytes or the proof is over something other than what is dispatched. */
	body?: string;
};

type TMessageHandler = (data: unknown, requestInfo?: TTransportRequestInfo) => unknown | Promise<unknown>;

export interface ITransport {
	send(data: unknown): void;
	onMessage(handler: TMessageHandler): void;
}

export const TRANSPORT = "transport";

/** The transport's own methods that read rather than act: a page asks these of the transport itself, which has no step
 *  to declare them. Listing the steps a site offers is a read of the site, and a page makes it to find its way about. */
const TRANSPORT_READS = new Set(["step.list", "step.validate"]);

export class SSETransport implements ITransport, IStepTransport {
	readonly name = "SSETransport";
	private hub = new EventEmitter();
	public webserver: IWebServer;
	private eventLogger: IEventLogger;
	private messageHandlers: TMessageHandler[] = [];

	/** The registry this transport dispatches through, which says which methods are reads. */
	private registry?: StepRegistry;

	constructor(webserver: IWebServer, eventLogger: IEventLogger) {
		this.webserver = webserver;
		this.eventLogger = eventLogger;
		this.setupRoutes();
	}

	private setupRoutes(): void {
		this.webserver.addRoute("get", "/sse", { description: "Server-Sent Events stream for live framework events" }, async (c) => {
			this.eventLogger.debug("SSE Client connected");
			return await streamSSE(c, async (sseStream) => {
				// The stream announces what happens from here on. What happened before is in the graph, which a
				// connecting page reads; nothing is replayed to it.
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
			// Read the body once, as the bytes it arrived as, and take what the request asks out of those same bytes: a
			// proof covers a digest of what was sent, so parsing a second reading would leave what is checked and what
			// is dispatched two different things.
			let body: string;
			let data: unknown;
			try {
				body = await c.req.text();
				data = JSON.parse(body);
			} catch (e) {
				this.eventLogger.error(`Error parsing RPC POST message: ${e}`);
				return c.json({ ok: false, error: String(e) }, 400);
			}
			const requestInfo: TTransportRequestInfo = { headers: c.req.header(), method: c.req.method, url: c.req.url, body };
			const isStream = (data as Record<string, unknown>).stream === true;

			// Streaming requests open an NDJSON response and run the same dispatcher inside `streamContext`. Step actions read the per-request emit callback from AsyncLocalStorage and push chunks during execution; the final dispatchStep result (success or refusal) lands on the seqPath via stepStart/stepEnd lifecycle events. No dual handler path: one dispatcher, one error contract.
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
						// Successful dispatch already pushed its content via streamContext.emit; emitting the products again would duplicate the stream. On refusal, emit the error as a terminating record so the client surfaces it. The lifecycle stepEnd event already fired on the seqPath via dispatchStep, seq-bound consumers see the canonical record there.
						if (response.error) await writeChunk({ error: response.error });
					});
				});
			}

			// A call states what it asks of the run, and the run holds it to the step's own declaration: asked to answer a
			// step that does not declare itself a read, it refuses rather than answering and recording the reading as
			// something the run did. A step declared a read is answered without a line of its own here, since a page
			// following a run reads it on every announcement.
			const servesARead = this.servesARead(data);
			const asksToRead = (data as { asks?: unknown } | undefined)?.asks === "read";
			if (asksToRead && !servesARead) {
				const method = (data as Record<string, unknown>).method ?? "unknown";
				return c.json(
					{
						ok: false,
						error: `${method} was asked to answer a read, and does not declare itself one: a read is answered and leaves no record, so a step read by a page declares read: true`,
					},
					422,
				);
			}
			if (!servesARead) this.eventLogger.debug(`RPC: ${JSON.stringify(truncateForLog(data))}`);
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
		let payload: string;
		try {
			payload = JSON.stringify(data);
		} catch (err) {
			// Payload too large to serialize (V8 raises RangeError around 512MB) or
			// otherwise unstringifiable. Emit a replacement event so the SSE stream
			// stays alive, losing one oversized broadcast is acceptable; losing
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
		this.hub.emit("event", payload);
	}

	public onMessage(handler: TMessageHandler) {
		this.messageHandlers.push(handler);
	}

	/** IStepTransport: register the step registry (routes already set up at construction). What the registry answers is
	 *  which methods are reads, so serving one is not narrated as an act of the run. */
	attach(registry: StepRegistry, _webserver: IWebServer): void {
		this.registry = registry;
	}

	/**
	 * Whether a call asks the run a question rather than acting on it.
	 *
	 * Reading a run is not an act of the run, which is why a read invoked into a running instance writes no record and
	 * announces no step. Narrating that a read was served is the same fact by another route: a view reading at a level
	 * that carried the line would read the run again for its own reading, and each such read would be served, narrated
	 * and read again without end.
	 */
	private servesARead(data: unknown): boolean {
		const method = (data as { method?: unknown } | undefined)?.method;
		if (typeof method !== "string") return false;
		return TRANSPORT_READS.has(method) || this.registry?.get(method)?.stepDef?.read === true;
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
