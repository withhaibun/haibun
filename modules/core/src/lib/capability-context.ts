/**
 * The capability the step now running was authorized with, for the length of that step.
 *
 * A step that dispatches another step must run it under the same capability it was itself authorized with; otherwise
 * the same action would be allowed or refused depending on the route taken to it. The capability is held in an
 * AsyncLocalStorage store rather than on `world.runtime`, for two reasons: the async chain scopes it exactly to the
 * dispatch that set it, so concurrent dispatches never read each other's; and it is not a mutable field that
 * unrelated code can assign, so a step cannot change what it is authorized with by writing to the world.
 *
 * This is the same pattern step-stream-context uses for the streaming side-channel.
 *
 * What this does NOT defend against: code running in this process can import this module and call `run` itself. The
 * capability check exists for callers that reach a step over a transport (RPC, MCP, a model's tool call), which
 * cannot execute code here; a stepper registered in the configuration is already inside the process.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { AccessLevel } from "./resources.js";

const capabilityStore = new AsyncLocalStorage<string | string[] | undefined>();

/** Run `within` with `capability` as the authorization of every step it dispatches. */
export function runAuthorizedWith<T>(capability: string | string[] | undefined, within: () => Promise<T>): Promise<T> {
	return capabilityStore.run(capability, within);
}

/** What the calling step was authorized with, or undefined outside any dispatch. */
export function authorizedWith(): string | string[] | undefined {
	return capabilityStore.getStore();
}

const askStore = new AsyncLocalStorage<string | undefined>();

/**
 * The ask a step is running under: the exchange that called it, for a step that records what it did.
 *
 * It is scoped the same way and for the same reason as the capability. On the world it would be one value for the
 * whole process, so a second ask in flight would read or clear the first one's; in the async context it belongs to
 * the call that set it.
 */
export function runAsking<T>(askId: string | undefined, within: () => Promise<T>): Promise<T> {
	return askStore.run(askId, within);
}

/** The ask this step is answering, or undefined when nothing asked for it. */
export function askedIn(): string | undefined {
	return askStore.getStore();
}

const actingStore = new AsyncLocalStorage<string | undefined>();

/**
 * Who a call proved itself to be, for the length of that call.
 *
 * A boundary that checks a proof learns who made it, and what is done under that proof is done by them. Held here
 * rather than on the world for the reason the capability is: the world has one value for the whole process, so two
 * requests in flight would be recorded as each other, and this belongs to the call that proved it.
 */
export function runActingAs<T>(principal: string | undefined, within: () => Promise<T>): Promise<T> {
	return actingStore.run(principal, within);
}

/** Who proved themselves at the boundary this call came through, or undefined where nothing did. */
export function actingAs(): string | undefined {
	return actingStore.getStore();
}

const readCeilingStore = new AsyncLocalStorage<AccessLevel | undefined>();

/**
 * The most a read may see, for the length of the call that entered here.
 *
 * A ceiling each read opts into is not a ceiling: a store scoped by whoever happens to query it is bounded only where
 * someone remembered to bound it. So the boundary a call arrives at states what that caller may see, once, and every
 * read inside it is bounded by that whether or not it says anything about access. A read that names a level of its own
 * still cannot exceed this one; it can only ask for less.
 *
 * Scoped like the capability, and for the same reasons: the async chain bounds it to the call that set it, and it is
 * not a field on the world that later code can widen.
 */
export function runReadingAt<T>(ceiling: AccessLevel | undefined, within: () => Promise<T>): Promise<T> {
	return readCeilingStore.run(ceiling, within);
}

/** The ceiling in force, or undefined where nothing bounded the caller (a feature line in its own run). */
export function readingAt(): AccessLevel | undefined {
	return readCeilingStore.getStore();
}
