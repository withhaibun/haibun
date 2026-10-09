/**
 * Holds the capability that authorized the running step, for the duration of that step.
 *
 * A step that dispatches another step runs it under its own capability. Otherwise the route to an action would
 * determine whether the action is allowed or refused. An AsyncLocalStorage store holds the capability instead of
 * `world.runtime`, for two reasons. The async chain scopes the capability to the dispatch that set it, so concurrent
 * dispatches don't read each other's capability. The store isn't a mutable field that unrelated code can assign, so a step can't
 * change its authorization by writing to the world.
 *
 * The step-stream-context module uses the same pattern for the streaming side-channel.
 *
 * This module doesn't defend against code in this process. Such code can import this module and call
 * `runAuthorizedWith` or `runInvoking` itself. The capability check applies to callers that reach a step over a
 * transport (RPC, MCP, a model's tool call). Those callers can't execute code here. A stepper registered in the
 * configuration already executes inside the process.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { Access, narrowerCeiling, type AccessLevel } from "./resources.js";
import { capabilityAllows, EVERY_ACTION, readAction, readCeilingOf, type TAccessBound, type TCallAuthority } from "./actions.js";
import type { TActingFor, TRestsOn } from "./authority-types.js";
import type { THaibunLogLevel } from "../schema/protocol.js";

const capabilityStore = new AsyncLocalStorage<TCallAuthority>();

/**
 * Runs `within` with `capability` as the authorization of every step it dispatches in this process. `capability` is both
 * what the call invokes and what it holds. A delegation holder invokes the held action that allows each step, so what
 * it may invoke and what it holds are one list. Actuality's own feature and a turn that holds its asker's delegation
 * are such holders.
 */
export function runAuthorizedWith<T>(capability: string | string[] | undefined, within: () => Promise<T>): Promise<T> {
	return capabilityStore.run({ invoked: capability, held: capability }, within);
}

/**
 * Runs `within` as a call that a caller outside the process invoked. A ZCAP-LD invocation names one action, and the
 * call is authorized for that action alone. The chain the caller presents proves what the caller holds. What the
 * caller holds bounds what the call reads and is shown.
 */
export function runInvoking<T>(authority: TCallAuthority, within: () => Promise<T>): Promise<T> {
	return capabilityStore.run(authority, within);
}

/** The authority that actuality's own features hold. Actuality acts for the instance itself, so a step that its features
 *  state is the instance's own act. A statement that narrows the authority for part of a feature states the narrower one. */
export const RUN_AUTHORITY = [EVERY_ACTION];

/** Returns the capability that authorized the calling step, or undefined outside a dispatch. */
export function authorizedWith(): string | string[] | undefined {
	return capabilityStore.getStore()?.invoked;
}

/** Returns what the calling step's caller holds, or undefined outside a dispatch. What the caller holds bounds what the
 *  step reads, writes and is shown. */
export function callerHolds(): string | string[] | undefined {
	return capabilityStore.getStore()?.held;
}

const shownStore = new AsyncLocalStorage<string | string[] | undefined>();

/** Runs `within` so that each listing of steps it makes shows what `held` allows. A caller that acts for another is shown
 *  what the other holds. It calls only what it holds itself, so a listed step it may not call is one the other may allow. */
export function runShowing<T>(held: string | string[] | undefined, within: () => Promise<T>): Promise<T> {
	return shownStore.run(held, within);
}

/** Returns what a listing of steps shows the calling step. That is what the caller it acts for holds, else what its own
 *  caller holds. */
export function shownTo(): string | string[] | undefined {
	return shownStore.getStore() ?? callerHolds();
}

const askStore = new AsyncLocalStorage<string | undefined>();

/**
 * Holds the id of the ask a step runs under. The ask is the exchange that called the step. A step that records what it
 * did reads the id.
 *
 * The id is scoped like the capability, for the same reason. A world field would hold one value for the whole process,
 * so a second ask in flight would read or clear the first ask's id. The async context scopes the id to the call that
 * set it.
 */
export function runAsking<T>(askId: string | undefined, within: () => Promise<T>): Promise<T> {
	return askStore.run(askId, within);
}

/** Returns the id of the ask the calling step runs under, or undefined where a caller didn't set one. */
export function askedIn(): string | undefined {
	return askStore.getStore();
}

const actingStore = new AsyncLocalStorage<{ principal: string | undefined; restsOn: TRestsOn | undefined }>();

/**
 * Holds the principal a call proved, for the duration of that call.
 *
 * A boundary that checks a proof determines the principal that made it. An act done under that proof is that
 * principal's act. The async context holds the principal instead of the world, for the same reason as the capability.
 * A world field would hold one value for the whole process, so each of two requests in flight would be recorded as the
 * other. The async context scopes the principal to the call that proved it. `runActingAs` exits the step context, so
 * the call isn't part of the step during which it arrived. A request a server receives isn't part of the step that
 * started the server either. The first step the call runs is the outermost step of the call.
 */
export function runActingAs<T>(principal: string | undefined, within: () => Promise<T>, restsOn?: TRestsOn): Promise<T> {
	return actingStore.run({ principal, restsOn }, () => stepStore.exit(within));
}

/** Returns the principal this call acts as, or undefined where the call doesn't act as a principal. A boundary sets the
 *  principal it verified, and a tick sets the principal that started its ticker. */
export function actingAs(): string | undefined {
	return actingStore.getStore()?.principal;
}

/** Returns what this call's proof rests on: the capabilities of its delegation chain and the time the first expires.
 *  Returns undefined where the call didn't present a proof. Actuality's own statements don't present one. */
export function restingOn(): TRestsOn | undefined {
	return actingStore.getStore()?.restsOn;
}

/** Returns the principal of an authority act. It returns the root where the calling step's authorization
 *  allows every action. Actuality's own features and its owner hold that authorization. Else it returns the key the
 *  caller proved. That key acts only within its delegation. Else it returns undefined. */
export function actingFor(): TActingFor | undefined {
	if (capabilityAllows(authorizedWith(), EVERY_ACTION)) return { root: true };
	const controller = actingAs();
	return controller ? { root: false, controller } : undefined;
}

/** The running step. It holds the step's seqPath, the log level at which the step's logs report, and the seqPath of the
 *  outermost step of its call. A step that another step didn't dispatch is its own outermost step. */
type TStepInFlight = { seqPath: string; reportsAt: THaibunLogLevel | undefined; outermost: string };

const stepStore = new AsyncLocalStorage<TStepInFlight | undefined>();

/**
 * Holds the step a call is part of, for the duration of the step's dispatch.
 *
 * Each write, log and record of a step names that step. A world field would hold one step for the whole process. Two
 * readers' calls into actuality are two steps in flight, and each would name the step dispatched last. A step that
 * dispatched another would name the inner step until the inner step ended. Each call reads its own step from the
 * async context.
 */
export function runInStep<T>(step: Omit<TStepInFlight, "outermost">, within: () => T): T {
	return stepStore.run({ ...step, outermost: stepStore.getStore()?.outermost ?? step.seqPath }, within);
}

/** Returns the step this call is part of, or undefined outside a dispatch. */
export function stepInFlight(): TStepInFlight | undefined {
	return stepStore.getStore();
}

/** The read scope of a call. `ceiling` is the broadest level the call reads, and is undefined for the instance's own reads.
 *  A call whose caller doesn't hold a read action holds `refusal` in place of a ceiling. */
export type TReadScope = { ceiling: AccessLevel | undefined } | { refusal: string };

const readScopeStore = new AsyncLocalStorage<TReadScope>();

/** The refusal of a read of records in a call whose caller doesn't hold a read action. It names the narrowest read action,
 *  which the caller requests from the key that delegates its actions. */
export const WITHOUT_READ_REFUSAL = `reading records requires a read action, and the caller doesn't hold one: capability ${readAction(Access.public)} required. Request it from the key that delegates the caller's actions.`;

/**
 * Holds the broadest level a read may see, for the duration of the call that set it.
 *
 * An opt-in ceiling would leave each read that omitted it unbounded. The boundary that receives a call sets
 * the caller's ceiling once. That ceiling bounds every read inside the call, whether or not the read states an access
 * level. A read that names its own level reads at the narrower of that level and the ceiling.
 *
 * The ceiling is scoped like the capability, for the same reasons. The async chain bounds it to the call that set it.
 * It isn't a world field that later code can widen. A scope set inside another takes the narrower of its own level and
 * the ceiling in force. A call inside a boundary therefore doesn't read above the boundary's ceiling. A model turn that
 * reads at its context's resolved level is such a call. A scope set inside a call whose caller doesn't hold a read action
 * keeps that call's refusal.
 */
export function runReadingAt<T>(ceiling: AccessLevel | undefined, within: () => Promise<T>): Promise<T> {
	const scope = readScopeStore.getStore();
	if (scope !== undefined && "refusal" in scope) return within();
	return readScopeStore.run({ ceiling: narrowerCeiling(scope?.ceiling, ceiling) }, within);
}

/** Runs `within` at the broadest read that `held` allows. Where `held` doesn't hold a read action, each read of records
 *  within it throws `WITHOUT_READ_REFUSAL`, and its writes are written within `writeBound`. A step, a served method and a tick run under what their caller holds. */
export function runReadingAsHeld<T>(held: string | string[] | undefined, within: () => Promise<T>): Promise<T> {
	const ceiling = readCeilingOf(held);
	return ceiling === undefined ? readScopeStore.run({ refusal: WITHOUT_READ_REFUSAL }, within) : runReadingAt(ceiling, within);
}

/** Returns the read scope in force, or undefined outside a call. Dispatch holds it as the scope of the statement. */
export function readScope(): TReadScope | undefined {
	return readScopeStore.getStore();
}

/** Returns the ceiling in force, or undefined where a ceiling doesn't bound the caller. A line of actuality's own
 *  features isn't bounded by a ceiling. Throws the scope's refusal where the caller doesn't hold a read action. */
export function readingAt(): AccessLevel | undefined {
	const scope = readScopeStore.getStore();
	if (scope === undefined) return undefined;
	if ("refusal" in scope) throw new Error(scope.refusal);
	return scope.ceiling;
}

/** Returns the level of what the call in progress may have read: the call's ceiling. Throws outside a call, since the
 *  instance's own work reads without a ceiling and doesn't state a level. */
export function readLevel(): AccessLevel {
	const ceiling = readingAt();
	if (ceiling === undefined)
		throw new Error("readLevel returns the read level of a call, and this code runs outside one. Run it inside dispatchStep, runReadingAt or runReadingAsHeld.");
	return ceiling;
}

const statedAtStore = new AsyncLocalStorage<{ scope: TReadScope | undefined }>();

/**
 * Runs `within` as the step a statement states, and holds `scope` as the statement's read scope. `scope` is the scope in
 * force at dispatch, before the step's own authority narrows it. A statement's arguments are its author's, so
 * `readingAsStated` reads them in the author's scope. The step reads in its own scope.
 */
export function runStatedAt<T>(scope: TReadScope | undefined, within: () => Promise<T>): Promise<T> {
	return statedAtStore.run({ scope }, within);
}

/** Runs `within` in the read scope of the dispatched statement, so `within` reads the statement's arguments in that scope.
 *  Outside a dispatch it runs `within` in the scope in force. */
export function readingAsStated<T>(within: () => Promise<T>): Promise<T> {
	const stated = statedAtStore.getStore();
	if (stated === undefined) return within();
	return stated.scope === undefined ? readScopeStore.exit(within) : readScopeStore.run(stated.scope, within);
}

/** Returns the bound of the call in progress: its ceiling and what its caller holds. Every store reads within this bound.
 *  Throws the scope's refusal where the caller doesn't hold a read action. */
export function accessBound(): TAccessBound {
	return { ceiling: readingAt(), held: callerHolds() };
}

/** Returns the bound that a write and an event of the call in progress are written within: the call's ceiling and what its
 *  caller holds. A caller that doesn't hold a read action hasn't read a record, so a ceiling doesn't bound its writes. Its
 *  write is gated by the write's own action, and `writtenAt` writes it at the level it states or its type declares. */
export function writeBound(): TAccessBound {
	const scope = readScopeStore.getStore();
	return { ceiling: scope !== undefined && "ceiling" in scope ? scope.ceiling : undefined, held: callerHolds() };
}

/**
 * Runs `within` as the instance itself, without the ceiling of the call it is part of. Only the authority's own
 * operations call it. They verify a chain a caller presents, return the delegations of a key, and delegate, invoke or
 * revoke for a caller that holds the action each act requires. Each reads the instance's records and returns the
 * verdict, the delegations the key already holds, or the act's result.
 */
export function runReadingAsTheInstance<T>(within: () => Promise<T>): Promise<T> {
	return readScopeStore.run({ ceiling: undefined }, within);
}

/** Runs `within` as a tick, for work that outlives the step that started it. The tick holds only `needs` and reads at the
 *  broadest level `needs` allows. Where `needs` doesn't hold a read action, the tick's reads of records are refused. It
 *  acts as `startedBy` under `restsOn`. `startedBy` is the principal that started the ticker, and `restsOn` is
 *  what that start's proof rests on. */
export function runAsTicking<T>(needs: readonly string[], startedBy: string | undefined, restsOn: TRestsOn | undefined, within: () => Promise<T>): Promise<T> {
	const held = [...needs];
	return runAuthorizedWith(held, () => readScopeStore.exit(() => runReadingAsHeld(held, () => runActingAs(startedBy, within, restsOn))));
}
