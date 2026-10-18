/**
 * A server's event stream and the `/rpc` calls it carries. The stream sends each of actuality's events to every follower
 * that may read at the event's level, awaiting each write, and ends a follower past a named count of writes in flight.
 * A call reaches each handler of the transport under the request it arrived in, whose proof covers its bytes.
 */
import { EventEmitter } from "events";
import { z } from "zod";
import { stream, streamSSE } from "hono/streaming";
import type { IEventLogger } from "@haibun/core/lib/steps/ports.js";
import { truncateForLog, errorDetail } from "@haibun/core/lib/util/index.js";
import type { StepRegistry } from "@haibun/core/lib/step-registry.js";
import { streamContext, streamOver, type TStreamChunk } from "@haibun/core/lib/step-stream-context.js";
import {
	ACTUALITY_HEADER,
	actualityRefusal,
	authorityFailed,
	REFUSED_CALL_STATUS,
	REFUSED_INVOCATION,
	SSE_ROUTE,
	RpcRefusalSchema,
	RpcEnvelopeSchema,
} from "@haibun/core/lib/rpc-wire.js";
import type { TRuntime } from "@haibun/core/lib/world.js";
import type { THaibunEvent } from "@haibun/core/lib/domains/protocol.js";
import { serializedEvent } from "@haibun/core/lib/steps/derivations/serialized-event.js";
import { capabilityAllows, FOLLOWS_THE_RUN, readAction } from "@haibun/core/lib/actions.js";
import type { AccessLevel } from "@haibun/core/lib/resources.js";
import { pathParam, type IWebServer, type TAuthorizedRequest, type TCapabilityVerifier } from "../ports.js";
import type { IStepTransport, ITransport, TMessageHandler } from "../domains/transport.js";
import { follower } from "../machines/follower.js";

/** What the transport reads of a call before a handler reads all of it: whether it streams, and what it requests. */
const RpcRouteSchema = RpcEnvelopeSchema.pick({ stream: true, asks: true }).partial().loose();

/** The refusal a result states, where it refuses its call. */
const resultRefusal = (result: unknown) => RpcRefusalSchema.safeParse(result).data;

/** Payload Too Large: a result too long to serialize. */
const TOO_LARGE = 413;

/** What an event stream reads: the server that mounts its routes, the events hub that logs it, actuality's runtime, the
 *  verifier of each request's authority, and how many writes may be in flight to one follower before it ends. */
export type TEventStreamParts = { webserver: IWebServer; eventLogger: IEventLogger; runtime: TRuntime; verifier: TCapabilityVerifier; writesInFlight: number };

export class SSETransport implements ITransport, IStepTransport {
	readonly name = "SSETransport";
	private hub = new EventEmitter();
	private messageHandlers: TMessageHandler[] = [];
	/** The registry this transport dispatches through, which states which methods are reads. */
	private registry?: StepRegistry;

	constructor(private readonly parts: TEventStreamParts) {
		this.hub.setMaxListeners(0);
		this.followRoute();
		this.callRoute();
	}

	private followRoute(): void {
		const { webserver, eventLogger, runtime, verifier } = this.parts;
		webserver.addRoute("get", SSE_ROUTE, { description: "Server-Sent Events stream for live framework events" }, async (c) => {
			const authority = await verifier.allowing(c, FOLLOWS_THE_RUN);
			if (authority instanceof Response) return authority;
			// Following is what the request invoked; which events it is sent is bounded by the reads its caller holds.
			const { held } = authority;
			// A follower states the actuality it follows, and the stream ends once this instance holds another.
			const following = c.req.header(ACTUALITY_HEADER);
			if (!following) return c.json({ error: `The event stream request doesn't name the actuality it follows in its ${ACTUALITY_HEADER} header.` }, 400);
			const notFollowing = actualityRefusal(following, runtime.actualityId);
			if (notFollowing) return c.json(notFollowing, 400);
			eventLogger.debug("SSE Client connected");
			return await streamSSE(c, async (sseStream) => {
				// The stream announces what happens from here: what happened before is in the graph, which a connecting page
				// reads, so the stream doesn't replay it. A follower receives each announcement its read level allows, so one
				// holding a public read follows the public part of actuality. The stream ends once the follower leaves, once
				// the authority it follows under lapses, once it holds more writes than it read, or once this instance holds
				// another actuality; connecting again under a revoked or expired delegation is refused.
				const followed = new AbortController();
				const counted = follower(this.parts.writesInFlight);
				let writing = Promise.resolve();
				const handler = (data: string, level: AccessLevel) => {
					if (runtime.actualityId !== following) return followed.abort(`this instance holds actuality ${runtime.actualityId}`);
					if (!capabilityAllows(held, readAction(level))) return;
					const sent = counted.sent();
					if (!sent.kept) return followed.abort(sent.reason);
					writing = writing
						.then(() => sseStream.writeSSE({ data, event: "message" }))
						.then(counted.written, (e: unknown) => followed.abort(`a write to the follower failed: ${errorDetail(e)}`));
				};
				this.hub.on("event", handler);
				sseStream.onAbort(() => followed.abort("the follower left"));
				verifier.endWhenLapsed(authority, followed.signal, (reason) => followed.abort(reason));
				await new Promise((resolve) => followed.signal.addEventListener("abort", resolve, { once: true }));
				this.hub.off("event", handler);
				eventLogger.debug(`SSE follower ended: ${String(followed.signal.reason)}`);
			});
		});
	}

	private callRoute(): void {
		const { webserver, eventLogger } = this.parts;
		webserver.addRoute("post", "/rpc/:_method", { description: "JSON-RPC dispatch for stepper methods" }, async (c) => {
			const method = pathParam(c, "_method");
			// The body is read once, as the bytes that arrived, and what the request requests is read from those same bytes: a
			// proof covers a digest of what was sent, so parsing a second reading would leave what is checked and what is
			// dispatched two different things.
			let body: string;
			let data: unknown;
			let envelope: z.infer<typeof RpcRouteSchema>;
			try {
				body = await c.req.text();
				data = JSON.parse(body);
				envelope = RpcRouteSchema.parse(data);
			} catch (e) {
				const error = `${method}: the request's body isn't a JSON-RPC call: ${errorDetail(e)}. Send the envelope rpcEnvelope builds.`;
				eventLogger.error(error);
				return c.json({ ok: false, error }, 400);
			}
			const request: TAuthorizedRequest = { headers: c.req.header(), method: c.req.method, url: c.req.url, body };

			// A streamed call opens an NDJSON response and runs the same dispatcher inside `streamContext`. A step's action reads
			// the request's emit callback from the context and sends chunks as it runs; the dispatch's result, success or
			// refusal, lands on the seqPath through the lifecycle events. One handler path: one dispatcher, one error contract.
			if (envelope.stream === true) {
				c.header("Content-Type", "application/x-ndjson");
				return stream(c, async (s) => {
					const stopped = new AbortController();
					s.onAbort(() => stopped.abort());
					const writeChunk = async (chunk: TStreamChunk | Record<string, unknown>) => {
						await s.write(new TextEncoder().encode(`${JSON.stringify(chunk)}\n`));
					};
					// Hono's stream keeps the order of the NDJSON writes; an action's synchronous emit doesn't carry the stream's
					// backpressure, which isn't an action's concern.
					const emit = (chunk: TStreamChunk) => void writeChunk(chunk);
					await streamContext.run(streamOver(emit, stopped), async () => {
						const result = await this.handleMessage(data, request);
						if (result === undefined) return await writeChunk({ error: `RPC method ${method} doesn't have a handler` });
						// A dispatch that succeeded sent its content through the stream already, so its products aren't sent again. A
						// refusal ends the stream as its last record; the lifecycle events carry the canonical record on the seqPath.
						const refused = resultRefusal(result)?.error;
						if (refused) await writeChunk({ error: refused });
					});
				});
			}

			// A step declared a read is served without a line of its own here, since a page following a run reads it on every
			// announcement.
			if (!this.servesARead(method)) eventLogger.debug(`RPC: ${JSON.stringify(truncateForLog(data, 0))}`);
			const result = await this.handleMessage(data, request);
			if (result === undefined) return c.json({ ok: false, error: `RPC method ${method} doesn't have a handler` }, 404);
			// A request whose presented authority failed is refused as forbidden, which differs from a call refused for lack of
			// a capability it didn't present.
			const refused = resultRefusal(result);
			const status = !refused ? 200 : authorityFailed(refused) ? REFUSED_INVOCATION : REFUSED_CALL_STATUS;
			try {
				return c.json(result, status);
			} catch (serializeErr) {
				// V8 raises RangeError where JSON.stringify would build a string longer than about 512MB. A structured error
				// takes the place of an unhandled throw, which would stall the client's fetch.
				const reason = errorDetail(serializeErr);
				eventLogger.error(`RPC ${method} response too large to serialize: ${reason}`);
				return c.json({ ok: false, error: `${method}: response too large to serialize (${reason}). Narrow the query or return a summary.` }, TOO_LARGE);
			}
		});
	}

	/** Sends an event to each follower that may read at its level. The event's text is the one the events hub serialized,
	 *  so an event is serialized once for every transport. An event that doesn't serialize is sent as a record of its
	 *  drop, so the stream continues. */
	public sendEvent(event: THaibunEvent): void {
		if (this.hub.listenerCount("event") === 0) return;
		// EventLogger.emit states every event's level, and a follower receives the events its read level allows.
		if (event.accessLevel === undefined)
			throw new Error(`SSETransport.sendEvent refuses an event that doesn't state its access level. Emit the event through EventLogger.emit, which states it.`);
		this.hub.emit("event", this.payloadOf(event), event.accessLevel);
	}

	private payloadOf(event: THaibunEvent): string {
		try {
			return `{"type":"event","event":${serializedEvent(event)}}`;
		} catch (err) {
			// JSON.stringify throws for a text longer than V8's limit, around 512MB. The record of the drop keeps the stream open.
			const { id, timestamp, kind, level, accessLevel } = event;
			const droppedReason = errorDetail(err);
			this.parts.eventLogger.error(`the event ${id} was dropped from the stream, since it doesn't serialize: ${droppedReason}`);
			return JSON.stringify({ type: "event", event: { id, timestamp, kind, level, accessLevel, dropped: true, droppedReason } });
		}
	}

	public onMessage(handler: TMessageHandler) {
		this.messageHandlers.push(handler);
	}

	/** Holds the registry the transport's calls dispatch through, which states which methods are reads, so serving one isn't
	 *  narrated as an act of actuality. */
	attach(registry: StepRegistry): void {
		this.registry = registry;
	}

	/**
	 * Whether a call reads actuality rather than acting upon it. Reading actuality isn't an act of actuality, which is why a read
	 * invoked into a running instance doesn't write a record and doesn't announce a step. Narrating that a read was served
	 * would be the same fact by another route: a view reading at a level that carried the line would read actuality again
	 * for its own reading, and each such read would be served, narrated and read again without end.
	 */
	private servesARead(method: string): boolean {
		return this.registry?.get(method)?.descriptor.read === true;
	}

	/** Clears the handlers as the server closes. */
	detach(): void {
		this.messageHandlers = [];
	}

	private async handleMessage(data: unknown, request: TAuthorizedRequest): Promise<unknown> {
		for (const handler of this.messageHandlers) {
			const result = await handler(data, request);
			if (result !== undefined) return result;
		}
		return undefined;
	}
}
