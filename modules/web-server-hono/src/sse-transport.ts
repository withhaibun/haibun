import { EventEmitter } from "events";
import { z } from "zod";
import { stream } from "hono/streaming";
import { streamSSE } from "hono/streaming";
import type { IWebServer } from "./defs.js";
import type { IEventLogger } from "@haibun/core/lib/EventLogger.js";
import { truncateForLog, errorDetail } from "@haibun/core/lib/util/index.js";
import type { StepRegistry } from "@haibun/core/lib/step-registry.js";
import { streamContext, streamOver, type TStreamChunk } from "@haibun/core/lib/step-stream-context.js";
import type { IStepTransport } from "./step-transport.js";
import { RPC_REFUSED, RpcRequestSchema } from "@haibun/core/lib/rpc-wire.js";
import type { TRuntime } from "@haibun/core/lib/world.js";
import { capabilityAllows, FOLLOWS_THE_RUN, readAction } from "@haibun/core/lib/actions.js";
import { Access, AccessLevelSchema, type AccessLevel } from "@haibun/core/lib/resources.js";
import { authorityAllowing, endWhenLapsed } from "./capability-auth.js";

type TTransportRequestInfo = {
	headers?: Record<string, string | undefined>;
	/** What the request asks, and of what: a presentation signed over the request covers both. */
	method?: string;
	url?: string;
	/** The body exactly as it arrived. A signature covers a digest of these bytes, and what the request asks is read
	 *  out of them, so the two are the same bytes or the proof is over something other than what is dispatched. */
	body?: string;
};

type TMessageHandler = (data: unknown, requestInfo?: TTransportRequestInfo) => unknown | Promise<unknown>;

/** What the transport reads of a call before a handler reads all of it: its method, whether it streams, and what it asks. */
const RpcEnvelopeSchema = RpcRequestSchema.pick({ method: true, stream: true, asks: true }).partial().loose();

/** The reason an answer states for refusing its call, where it states one. */
const refusalReason = (answer: unknown): unknown => (typeof answer === "object" && answer !== null && "error" in answer ? answer.error : undefined);

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

	/** The registry this transport dispatches through, which says which methods are reads. */
	private registry?: StepRegistry;

	constructor(
		webserver: IWebServer,
		eventLogger: IEventLogger,
		private readonly runtime: TRuntime,
	) {
		this.webserver = webserver;
		this.eventLogger = eventLogger;
		this.setupRoutes();
	}

	private setupRoutes(): void {
		this.webserver.addRoute("get", "/sse", { description: "Server-Sent Events stream for live framework events" }, async (c) => {
			const authority = await authorityAllowing(c, FOLLOWS_THE_RUN, this.runtime, this.webserver.allowedWithoutDelegation);
			if (authority instanceof Response) return authority;
			const { granted } = authority;
			this.eventLogger.debug("SSE Client connected");
			return await streamSSE(c, async (sseStream) => {
				// The stream announces what happens from here on. What happened before is in the graph, which a
				// connecting page reads; the stream doesn't replay events to it. Each announcement goes to a follower that may read at
				// its level, so one holding a public read follows the public part of the run.
				const handler = (data: string, level: AccessLevel) => {
					if (!capabilityAllows(granted, readAction(level))) return;
					sseStream.writeSSE({ data, event: "message" }).catch((e) => {
						this.eventLogger.error(`Error writing to SSE stream: ${e}`);
					});
				};
				this.hub.on("event", handler);
				// The stream is open until its follower leaves or the authority it follows under lapses; a follower whose
				// delegation was revoked or expired isn't sent further events, and connecting again is refused.
				const followed = new AbortController();
				sseStream.onAbort(() => followed.abort("the follower left"));
				endWhenLapsed(this.runtime, authority, followed.signal, (reason) => followed.abort(reason));
				await new Promise((resolve) => followed.signal.addEventListener("abort", resolve, { once: true }));
				this.hub.off("event", handler);
				this.eventLogger.debug(`SSE follower ended: ${String(followed.signal.reason)}`);
			});
		});

		this.webserver.addRoute("post", "/rpc/:_method", { description: "JSON-RPC dispatch for stepper methods" }, async (c) => {
			// Read the body once, as the bytes it arrived as, and take what the request asks out of those same bytes: a
			// proof covers a digest of what was sent, so parsing a second reading would leave what is checked and what
			// is dispatched two different things.
			let body: string;
			let data: unknown;
			let envelope: z.infer<typeof RpcEnvelopeSchema>;
			try {
				body = await c.req.text();
				data = JSON.parse(body);
				envelope = RpcEnvelopeSchema.parse(data);
			} catch (e) {
				this.eventLogger.error(`Error parsing RPC POST message: ${e}`);
				return c.json({ ok: false, error: String(e) }, 400);
			}
			const requestInfo: TTransportRequestInfo = { headers: c.req.header(), method: c.req.method, url: c.req.url, body };
			const isStream = envelope.stream === true;

			// Streaming requests open an NDJSON response and run the same dispatcher inside `streamContext`. Step actions read the per-request emit callback from AsyncLocalStorage and push chunks during execution; the final dispatchStep result (success or refusal) lands on the seqPath via stepStart/stepEnd lifecycle events. One handler path: one dispatcher, one error contract.
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
					await streamContext.run(streamOver(emit, abortController), async () => {
						const result = await this.handleMessage(data, requestInfo);
						if (result === undefined) {
							await writeChunk({ error: `RPC method ${envelope.method ?? "unknown"} doesn't have a handler` });
							return;
						}
						// Successful dispatch already pushed its content via streamContext.emit; emitting the products again would duplicate the stream. On refusal, emit the error as a terminating record so the client surfaces it. The lifecycle stepEnd event already fired on the seqPath via dispatchStep, seq-bound consumers see the canonical record there.
						const refusal = refusalReason(result);
						if (refusal) await writeChunk({ error: refusal });
					});
				});
			}

			// A call states what it asks of the run, and the run holds it to the step's own declaration: asked to answer a
			// step that does not declare itself a read, it refuses rather than answering and recording the reading as
			// something the run did. A step declared a read is answered without a line of its own here, since a page
			// following a run reads it on every announcement.
			const method = envelope.method ?? "unknown";
			const servesARead = this.servesARead(envelope.method);
			if (envelope.asks === "read" && !servesARead) {
				return c.json(
					{
						ok: false,
						error: `${method} was asked to answer a read, and does not declare itself one: a read is answered and doesn't leave a record, so a step read by a page declares read: true`,
					},
					422,
				);
			}
			if (!servesARead) this.eventLogger.debug(`RPC: ${JSON.stringify(truncateForLog(data))}`);
			const result = await this.handleMessage(data, requestInfo);
			if (result === undefined) {
				return c.json({ ok: false, error: `RPC method ${method} doesn't have a handler` }, 404);
			}
			// A request whose presented authority failed is unauthenticated, which is a different answer from a call refused
			// for want of a capability it didn't present.
			const unauthenticated = typeof result === "object" && result !== null && RPC_REFUSED in result && result[RPC_REFUSED];
			const status = unauthenticated ? 401 : refusalReason(result) ? 422 : 200;
			try {
				return c.json(result, status);
			} catch (serializeErr) {
				// V8 raises RangeError when JSON.stringify is asked for a string longer than ~512MB. Return a structured error instead of letting the unhandled throw stall the client's fetch.
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
		// Every event of the run states its level as it is emitted, and an event that doesn't state one is taken as private.
		this.hub.emit("event", payload, AccessLevelSchema.parse(data?.event?.accessLevel ?? Access.private));
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
	 * Reading a run is not an act of the run, which is why a read invoked into a running instance doesn't write a record and
	 * doesn't announce a step. Narrating that a read was served is the same fact by another route: a view reading at a level
	 * that carried the line would read the run again for its own reading, and each such read would be served, narrated
	 * and read again without end.
	 */
	private servesARead(method: string | undefined): boolean {
		if (method === undefined) return false;
		return this.registry?.get(method)?.descriptor.read === true;
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
