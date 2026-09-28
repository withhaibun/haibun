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
import { Access, narrowerCeiling, type AccessLevel } from "./resources.js";
import { capabilityAllows, EVERY_ACTION, type TAccessBound } from "./actions.js";
import type { TActingFor } from "./authority-types.js";
import type { THaibunLogLevel } from "../schema/protocol.js";

const capabilityStore = new AsyncLocalStorage<string | string[] | undefined>();

/** Run `within` with `capability` as the authorization of every step it dispatches. */
export function runAuthorizedWith<T>(capability: string | string[] | undefined, within: () => Promise<T>): Promise<T> {
	return capabilityStore.run(capability, within);
}

/** What a run's own feature holds: the run acts for the instance itself, so a step its features state is the
 *  instance's own act. A narrower authority for part of a feature is stated by the statement that narrows it. */
export const RUN_AUTHORITY = [EVERY_ACTION];

/** What the calling step was authorized with, or undefined outside any dispatch. */
export function authorizedWith(): string | string[] | undefined {
	return capabilityStore.getStore();
}

const shownStore = new AsyncLocalStorage<string | string[] | undefined>();

/** Run `within` showing every listing of steps it makes what `held` allows: a caller that acts for another is shown what
 *  that other holds, and calls only what it holds itself, so a call it may not make is one the other may allow. */
export function runShowing<T>(held: string | string[] | undefined, within: () => Promise<T>): Promise<T> {
	return shownStore.run(held, within);
}

/** What a listing of steps shows the calling step: what the caller it acts for holds, or else what it holds. */
export function shownTo(): string | string[] | undefined {
	return shownStore.getStore() ?? authorizedWith();
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

/** The ask this step is answering, or undefined when a caller didn't ask for it. */
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

/** Who proved themselves at the boundary this call came through, or undefined where a caller didn't. */
export function actingAs(): string | undefined {
	return actingStore.getStore();
}

/** Who an act of the authority is done for: the root, where the call holds every action, as the run's own features and
 *  its owner do; else the key the caller proved, which acts only within what it was delegated; else undefined. */
export function actingFor(): TActingFor | undefined {
	if (capabilityAllows(authorizedWith(), EVERY_ACTION)) return { root: true };
	const controller = actingAs();
	return controller ? { root: false, controller } : undefined;
}

/** The step running: its seqPath, and how prominently what is said while it runs reports. */
type TStepInFlight = { seqPath: string; reportsAt: THaibunLogLevel | undefined };

const stepStore = new AsyncLocalStorage<TStepInFlight | undefined>();

/**
 * The step a call is part of, for the length of the step's dispatch.
 *
 * What a step writes, logs and records names the step it was done in. Held on the world, the step was one value for the
 * whole process: two steps in flight, as two readers' calls into one run are, each named the step dispatched last, and a
 * step that dispatched another named the inner step until it ended. Held here, each call reads the step it belongs to.
 */
export function runInStep<T>(step: TStepInFlight, within: () => T): T {
	return stepStore.run(step, within);
}

/** The step this call is part of, or undefined outside any dispatch. */
export function stepInFlight(): TStepInFlight | undefined {
	return stepStore.getStore();
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
 * not a field on the world that later code can widen. A scope set inside another meets the ceiling already in force,
 * narrower winning, so a call inside a boundary, such as a model turn reading at the level its context resolved at,
 * never reads above what the boundary allowed.
 */
export function runReadingAt<T>(ceiling: AccessLevel | undefined, within: () => Promise<T>): Promise<T> {
	return readCeilingStore.run(narrowerCeiling(readCeilingStore.getStore(), ceiling), within);
}

/** The ceiling in force, or undefined where a ceiling didn't bound the caller (a feature line in its own run). */
export function readingAt(): AccessLevel | undefined {
	return readCeilingStore.getStore();
}

/** The level of what the call in progress may have read: its ceiling, or private for the run's own statements, which
 *  read without one. */
export function readLevel(): AccessLevel {
	return readingAt() ?? Access.private;
}

const statedAtStore = new AsyncLocalStorage<{ ceiling: AccessLevel | undefined }>();

/**
 * Run `within` as the step a statement states, where the statement was stated at `ceiling`: the ceiling in force where it
 * was dispatched, before the step's own authority narrows it. A statement's arguments are its author's, so they are read
 * at the ceiling the author reads at, while the step reads at its own.
 */
export function runStatedAt<T>(ceiling: AccessLevel | undefined, within: () => Promise<T>): Promise<T> {
	return statedAtStore.run({ ceiling }, within);
}

/** Read a statement's arguments at the ceiling it was stated at, or at the ceiling in force outside any dispatch. */
export function readingAsStated<T>(within: () => Promise<T>): Promise<T> {
	const stated = statedAtStore.getStore();
	return stated ? readCeilingStore.run(stated.ceiling, within) : within();
}

/** What bounds the call in progress, which every store writes and reads by: its ceiling and what it holds. */
export function accessBound(): TAccessBound {
	return { ceiling: readingAt(), held: authorizedWith() };
}

/**
 * Run `within` reading as the instance itself, without the ceiling of the call it is part of. For the authority's own
 * decisions and acts alone: checking a chain a caller presents, answering a key what was delegated to it, and delegating,
 * invoking and revoking for a caller that holds the action each takes. Each reads the instance's records to decide, and
 * returns the decision, what the key it answers already holds, or what the act made.
 */
export function runReadingAsTheInstance<T>(within: () => Promise<T>): Promise<T> {
	return readCeilingStore.run(undefined, within);
}
