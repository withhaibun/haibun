/**
 * The transports of a server: the event stream and the `/rpc` calls it carries, and a stepper that serves actuality's steps
 * another way, such as MCP. Other packages read the event stream through this module, as
 * `@haibun/web-server-hono/sse-transport.js`.
 */
import type { StepRegistry } from "@haibun/core/lib/step-registry.js";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";
import type { TAuthorizedRequest } from "../ports.js";

/** The runtime key that holds the event stream of the feature in progress. */
export const TRANSPORT = "transport";

/** Handles one `/rpc` call: its result, or undefined where this handler doesn't serve the call's method. */
export type TMessageHandler = (data: unknown, request: TAuthorizedRequest | undefined) => unknown;

/** A server's event stream, and the `/rpc` calls it carries to each handler. */
export interface ITransport {
	sendEvent(event: THaibunEvent): void;
	onMessage(handler: TMessageHandler): void;
}

/**
 * A stepper that serves actuality's steps through a transport of its own. The Executor attaches each one to actuality's
 * registry before the first feature starts, and a web server that closes detaches it.
 */
export interface IStepTransport {
	readonly name: string;
	attach(registry: StepRegistry): void;
	detach(): void;
}
