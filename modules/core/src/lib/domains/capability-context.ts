/**
 * Holds the record of the call in progress, for the duration of that call.
 *
 * A call's record states the action it invoked, the actions its caller holds, who the caller proved to be and what that
 * proof rests on, the delegation and the attributed agent, the read scope, the ask, the listing it is shown and the step in
 * flight. One AsyncLocalStorage store holds the record instead of `world.runtime`, for two reasons. The async chain scopes
 * the record to the dispatch that set it, so concurrent calls don't read each other's record. The store isn't a mutable
 * field that unrelated code can assign, so a step can't change its authorization by writing to the world. `runInCall` is
 * the one function that sets it, and `callerAt` and `nestedOf` derive the record of an outside caller and of a nested step.
 *
 * The step-stream-context module uses the same pattern for the streaming side-channel.
 *
 * This module doesn't defend against code in this process. Such code can import this module and call `runInCall` itself.
 * The capability check applies to callers that reach a step over a transport (RPC, MCP, a model's tool call). Those
 * callers can't execute code here. A stepper registered in the configuration already executes inside the process.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { Access, narrowerCeiling, type AccessLevel, type TTypeLevels } from "./resources.js";
import { capabilityAllows, EVERY_ACTION, lackedAction, readAction, readCeilingOf, writtenAt, type TAccessBound, type TCalled } from "./actions.js";
import { RestsOnSchema, type TActingFor, type TRestsOn } from "./authority-types.js";
import type { THaibunLogLevel } from "./protocol.js";
import type { TStepWrites } from "../steps/domains/contract.js";
import { RefusedCall, refusalSaid, type TRpcRefusal } from "../transport/domains/rpc-wire.js";

/** The actions a call names: one, several, or undefined where the call doesn't state any. */
type TActions = string | string[] | undefined;
const ActionsSchema = z.union([z.string(), z.array(z.string())]).optional();

/** The running step. It holds the step's seqPath, the log level at which the step's logs report, the writes its contract
 *  allows where it declares them, and the seqPath of the outermost step of its call. A step that another step didn't dispatch
 *  is its own outermost step. */
export type TStepInFlight = { seqPath: string; reportsAt: THaibunLogLevel | undefined; writes?: TStepWrites; outermost: string };

/** The read scope of a call. `ceiling` is the broadest level the call reads, and is undefined for the instance's own reads.
 *  A call whose caller doesn't hold a read action holds `refusal` in place of a ceiling. `from` is the list of held actions
 *  the scope was derived from, so a dispatch under the same list doesn't derive it again. */
export type TReadScope = ({ ceiling: AccessLevel | undefined } | { refusal: TRpcRefusal }) & { from?: string | string[] };

/**
 * The record of one call.
 * - `capabilityAction` is the action the call invoked, and `held` the actions its caller holds. A step dispatched beneath another
 *   doesn't hold a capabilityAction, and runs under the held action that allows it. `outside` states that the caller is outside
 *   actuality.
 * - `principal` is who proved themselves at the boundary, and `restsOn` the capabilities on which its proof rests.
 * - `delegation` names the record of the delegation under which the call was made, and `attributedTo` the agent to which the
 *   call is attributed, such as the model whose turn made it.
 * - `readScope` bounds what the call reads. `stated` holds the read scope of the statement a dispatch states, and `asOf`
 *   the path of the step whose actuality a read reads.
 * - `ask` is the id of the exchange that called the step, `shown` what a listing of steps shows, `step` the step in flight,
 *   and `delegatedWrites` the writes the contract of another instance's step allows for a store call that instance sends.
 */
export const CallContextSchema = z
	.object({
		capabilityAction: ActionsSchema,
		held: ActionsSchema,
		outside: z.literal(true).optional(),
		principal: z.string().optional(),
		restsOn: RestsOnSchema.optional(),
		delegation: RestsOnSchema.shape.delegation.optional(),
		attributedTo: z.string().optional(),
		readScope: z.custom<TReadScope>().optional(),
		stated: z.object({ scope: z.custom<TReadScope>().optional() }).optional(),
		asOf: z.array(z.number()).readonly().optional(),
		ask: z.string().optional(),
		shown: ActionsSchema,
		step: z.custom<TStepInFlight>().optional(),
		delegatedWrites: z.custom<TStepWrites>().optional(),
	})
	.strict();
export type TCallContext = z.infer<typeof CallContextSchema>;

const callStore = new AsyncLocalStorage<TCallContext>();

/** Runs `within` as the call `call` states. */
export function runInCall<T>(call: TCallContext, within: () => T): T {
	return callStore.run(call, within);
}

/** Returns the record of the call in progress, or undefined outside a call, where the code doesn't hold an action or read records. */
export function inCall(): TCallContext | undefined {
	return callStore.getStore();
}

/** The refusal of a read of records in a call whose caller doesn't hold a read action. Its remedy requests the narrowest read
 *  action from a key that delegates it. */
const WITHOUT_READ: TRpcRefusal = {
	error: "reading records requires a read action, and the caller doesn't hold one",
	remedy: { do: "request", action: readAction(Access.public) },
};
/** The message of the refusal of a read without a read action: its cause, then its remedy in words. */
export const WITHOUT_READ_REFUSAL = refusalSaid(WITHOUT_READ);

/** Returns the read scope at the broadest read that `held` allows, narrowed by `scope`. A scope derived from `held` itself is
 *  returned as it is, so a dispatch under the same list doesn't derive it again. Where `held` doesn't hold a read action, the
 *  scope refuses each read of records. A scope that refuses each read keeps its refusal. */
function heldScope(scope: TReadScope | undefined, held: TActions): TReadScope {
	if (scope !== undefined && held !== undefined && scope.from === held) return scope;
	const ceiling = readCeilingOf(held);
	if (ceiling === undefined) return { refusal: WITHOUT_READ, from: held };
	if (scope !== undefined && "refusal" in scope) return scope;
	return { ceiling: narrowerCeiling(scope?.ceiling, ceiling), from: held };
}

/** Who a boundary states a call is: the actions it holds, the actions its request presented where they are narrower, as a
 *  transport's caller states them, the principal it acts as, and the capabilities on which that principal's proof rests. */
export type TBoundaryCaller = { held: string[]; capabilityAction?: string[]; principal: string | undefined; restsOn?: TRestsOn };

/**
 * Returns the record of the caller a boundary states, in place of the record of the code that reached the boundary: it
 * invokes what its request presented, or what it holds where the caller doesn't state that, acts as its principal outside any
 * step under the delegation its proof presents, and reads at the broadest read it holds, or is refused each read of records
 * where it doesn't hold a read. A server's
 * request reaches its handler in the async context in which the server began listening, so each boundary and route runs
 * under this record to hold what it states rather than what that step held.
 */
export function callerAt(caller: TBoundaryCaller): TCallContext {
	const { held, principal, restsOn } = caller;
	return CallContextSchema.parse({
		capabilityAction: caller.capabilityAction ?? held,
		held,
		outside: true,
		...(principal === undefined ? {} : { principal }),
		...(restsOn === undefined ? {} : { restsOn, delegation: restsOn.delegation }),
		readScope: heldScope(undefined, held),
	});
}

/** Returns `call` inside the step `step`: each write, log and record of the call names that step, and the outermost step of
 *  the call stays the first step the call ran. */
export function inStep(call: TCallContext | undefined, step: Omit<TStepInFlight, "outermost">): TCallContext {
	return { ...call, step: { ...step, outermost: call?.step?.outermost ?? step.seqPath } };
}

/**
 * Returns the record of the work of a step dispatched under `call`, inside `step` where the work is a step's. The work doesn't
 * state a capabilityAction, since a caller didn't name it: a step it dispatches runs under the held action that allows it, within
 * the chain the caller presented. The read scope in force is the statement's scope, and the work reads at the broadest read its
 * caller holds. The agent to which a call is attributed is attributed with that call alone, so the work beneath the call
 * doesn't state the agent.
 */
export function nestedOf(call: TCallContext | undefined, step?: Omit<TStepInFlight, "outermost">): TCallContext {
	const { attributedTo: _attributed, capabilityAction: _presented, ...within } = { ...call };
	const nested = { ...within, stated: { scope: call?.readScope }, readScope: heldScope(call?.readScope, call?.held) };
	return step === undefined ? nested : inStep(nested, step);
}

/** Returns whether `call` is the work beneath a step rather than the step a caller named. `nestedOf` drops its capabilityAction,
 *  so the record states which it is, whether or not the work runs inside a step. */
export const isNested = (call: TCallContext | undefined): boolean => call?.capabilityAction === undefined;

/**
 * Returns the action `call` lacks to run `step`, or undefined where it may run it. It is the one gate of a dispatched step.
 * The step a call names is checked against the call's capabilityAction, which is ZCAP-LD's check of an invocation, and
 * against a read at its `readsAt` level among the actions held. A step dispatched beneath another is checked against the
 * actions held and its `readsAt` level, so the chain the caller presented bounds every nested step, and the instance's
 * own authority doesn't.
 */
export function mayRun(call: TCallContext | undefined, step: TCalled): string | undefined {
	if (!isNested(call) && !capabilityAllows(call?.capabilityAction, step.capability)) return step.capability;
	return lackedAction(call?.held, step);
}

/** Returns whether `call` is actuality acting as itself: an outside caller isn't present and the call holds every action. */
export const actsAsItself = (call: TCallContext | undefined): boolean => call?.outside !== true && capabilityAllows(call?.held, EVERY_ACTION);

/**
 * Returns the key for whom a request to another host acts within `call`: the principal of a caller outside actuality, whose
 * delegation to this instance's key the request presents. Returns undefined within actuality's own call, whose request presents
 * the instance's own delegation. Throws for a caller outside actuality that didn't prove a key, since such a caller can't
 * have delegated to the instance's key.
 */
export function delegatorOf(call: TCallContext | undefined): string | undefined {
	if (call?.outside !== true) return undefined;
	if (call.principal === undefined)
		throw new RefusedCall({ error: "a step on another host runs for a caller only under the caller's delegation, and this caller didn't prove a key. Sign the call" });
	return call.principal;
}

/**
 * Runs `within` with `capability` as the authorization of every step it dispatches in this process. `capability` is both
 * what the call invokes and what it holds. A delegation holder invokes the held action that allows each step, so what
 * it may invoke and what it holds are one list. Actuality's own feature and a statement that narrows what it holds are
 * such holders.
 */
export function runAuthorizedWith<T>(capability: TActions, within: () => Promise<T>): Promise<T> {
	return runInCall({ ...inCall(), capabilityAction: capability, held: capability }, within);
}

/** The authority that actuality's own features hold. Actuality acts for the instance itself, so a step that its features
 *  state is the instance's own act. A statement that narrows the authority for part of a feature states the narrower one. */
export const RUN_AUTHORITY = [EVERY_ACTION];

/** Returns what a listing of steps shows the calling step. That is what the caller it acts for holds, else what its own
 *  caller holds. */
export function shownTo(): TActions {
	const call = inCall();
	return call?.shown ?? call?.held;
}

/** Returns the principal of an authority act. It returns the root where actuality acts as itself: an outside caller isn't
 *  present and the call holds every action. Else it returns the key the caller proved. That key acts only within its
 *  delegation. Else it returns undefined. */
export function actingFor(): TActingFor | undefined {
	const call = inCall();
	if (actsAsItself(call)) return { root: true };
	return call?.principal ? { root: false, controller: call.principal } : undefined;
}

/** Returns `call` with the writes its step's contract allows replaced by `writes`, as a step's call states them once its arguments
 *  are read. A call outside a step stays as it is. */
export const writingIn = (call: TCallContext, writes: TStepWrites): TCallContext => (call.step === undefined ? call : { ...call, step: { ...call.step, writes } });

/** Returns the writes the contract of the step in progress allows: the step this call is part of, or the step of another
 *  instance whose store call this is. Undefined outside a step, and for a step on the contracts baseline. */
export function writesInFlight(): TStepWrites | undefined {
	const { step, delegatedWrites } = { ...inCall() };
	return step === undefined ? delegatedWrites : step.writes;
}

/**
 * Runs `within` at the broadest level `ceiling` allows, narrowed by the ceiling in force.
 *
 * An opt-in ceiling would leave each read that omitted it unbounded. The boundary that receives a call sets the caller's
 * ceiling once. That ceiling bounds every read inside the call, whether or not the read states an access level. A read
 * that names its own level reads at the narrower of that level and the ceiling. A call inside a boundary therefore doesn't
 * read above the boundary's ceiling. A model turn that reads at its context's resolved level is such a call. A scope set
 * inside a call whose caller doesn't hold a read action keeps that call's refusal.
 */
export function runReadingAt<T>(ceiling: AccessLevel | undefined, within: () => Promise<T>): Promise<T> {
	const call = inCall();
	const scope = call?.readScope;
	if (scope !== undefined && "refusal" in scope) return within();
	return runInCall({ ...call, readScope: { ceiling: narrowerCeiling(scope?.ceiling, ceiling), from: scope?.from } }, within);
}

/** Returns the ceiling in force, or undefined where a ceiling doesn't bound the caller. A line of actuality's own
 *  features isn't bounded by a ceiling. Throws the scope's refusal where the caller doesn't hold a read action. */
export function readingAt(): AccessLevel | undefined {
	const scope = inCall()?.readScope;
	if (scope === undefined) return undefined;
	if ("refusal" in scope) throw new RefusedCall(scope.refusal);
	return scope.ceiling;
}

/** Returns the level of what the call in progress may have read: the call's ceiling. Throws outside a call, since the
 *  instance's own work reads without a ceiling and doesn't state a level. */
export function readLevel(): AccessLevel {
	const ceiling = readingAt();
	if (ceiling === undefined) throw new Error("readLevel returns the read level of a call, and this code runs outside one. Run it inside dispatchStep or runReadingAt.");
	return ceiling;
}

/** Runs `within` in the read scope of the dispatched statement, so `within` reads the statement's arguments in that scope.
 *  A statement's arguments are its author's, so they are read in the author's scope, and the step reads in its own. Outside
 *  a dispatch it runs `within` in the scope in force. */
export function readingAsStated<T>(within: () => Promise<T>): Promise<T> {
	const call = inCall();
	return call?.stated === undefined ? within() : runInCall({ ...call, readScope: call.stated.scope }, within);
}

/** Returns the bound of the call in progress: its ceiling and what its caller holds. Every store reads within this bound.
 *  Throws the scope's refusal where the caller doesn't hold a read action. */
export function accessBound(): TAccessBound {
	return { ceiling: readingAt(), held: inCall()?.held };
}

/** Returns the bound that a write and an event of the call in progress are written within: the call's ceiling and what its
 *  caller holds. A caller that doesn't hold a read action hasn't read a record, so a ceiling doesn't bound its writes. Its
 *  write is gated by the write's own action, and `writtenAt` writes it at the level it states or its type declares. */
export function writeBound(): TAccessBound {
	const { readScope: scope, held } = { ...inCall() };
	return { ceiling: scope !== undefined && "ceiling" in scope ? scope.ceiling : undefined, held };
}

/** Returns the level the call in progress writes a record of a type declared at `declared`, where the record doesn't state a
 *  level, by the rule of every store (`writtenAt`). */
export function writtenLevel(declared: TTypeLevels): AccessLevel {
	return writtenAt(undefined, declared, writeBound());
}

/** A request as a server receives it: it holds an empty list of actions, acts as an unnamed principal outside any step, and
 *  is refused each read of records. Node serves a request in the async context in which its server began listening, so a
 *  request would otherwise hold what the step that started the server held. A route states what it holds: a boundary that
 *  verifies the request's proof runs as that caller, a route that reads public records states a public read, and a route
 *  that writes acts through a declared step. */
export const REQUEST_CALL = callerAt({ held: [], principal: undefined });

/** Returns the record of a caller that holds a read at `level` alone: a route that serves a document readers at that level may
 *  read, such as a DID document or a status list, states its read this way. */
export const readerAt = (level: AccessLevel): TCallContext => callerAt({ held: [readAction(level)], principal: undefined });

/**
 * Runs `within` as the instance itself, without the ceiling of the call that contains it. Only the authority's own
 * operations call it. They verify a chain a caller presents, return the delegations of a key, and delegate, invoke or
 * revoke for a caller that holds the action each act requires. Each reads the instance's records and returns the
 * verdict, the delegations the key already holds, or the act's result.
 */
export function runReadingAsTheInstance<T>(within: () => Promise<T>): Promise<T> {
	return runInCall({ ...inCall(), readScope: { ceiling: undefined } }, within);
}
