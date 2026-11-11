import { z } from "zod";
import type { AccessLevel } from "./resources.js";
import type { TRpcRefusal } from "../transport/domains/rpc-wire.js";

/**
 * This module declares only the framework's model of authority. A step declares the action it requires, a caller
 * presents evidence of authority, and a verifier determines whether the evidence allows the call. A consumer registers
 * its authorization specification and the verifier that reads it.
 *
 * This module doesn't name a specification, because naming one would select it for every consumer. It declares the
 * shape of a verification.
 */

/**
 * The evidence a caller presents to act with authority it holds. In this process the evidence is the document that
 * carries the authority. `action` is the one action the caller invokes under it, and is undefined where the caller
 * doesn't name one. A document presented without an action is checked for every action it allows. The document names its
 * controller, and `presenter` states who presents it: the root, or the key a caller proved. A verifier refuses a document where the presenter doesn't
 * prove it is the document's controller, since a document anyone can copy doesn't show who holds it. Over HTTP the
 * request is the presentation. It names the action and its target, and carries the proof that the caller may invoke that
 * action. The verifier registered for the evidence's specification reads it, and the framework doesn't read inside it.
 */
export type TAuthorityEvidence =
	| { kind: "document"; document: Record<string, unknown>; action?: string; target: string; presenter: TActingFor }
	| { kind: "request"; method: string; url: string; headers: Record<string, string | undefined>; body?: string };

/** How a deployment records a delegation: the record's type and its access level. A view opens the record only for a
 *  reader who may read that level. */
export type TDelegationRecord = { persistedAs: string; accessLevel: AccessLevel };

/**
 * The delegations to a key. `delegations` holds the signed documents the key presents, in the specification's form.
 * `records` maps each document's `id` to the record the deployment keeps of it, so a holder can open the record of a
 * delegation it acts under where it may read that record.
 */
export type TDelegations = { delegations: Record<string, unknown>[]; records?: Record<string, TDelegationRecord> };

/** The RPC method a key calls to read the delegations to it. It is the `delegationsTo` step of core's AuthorityStepper.
 *  The step returns the delegations to the key that signs the call. */
export const DELEGATIONS_READ_METHOD = "AuthorityStepper-delegationsTo";

/**
 * The action the delegation read requires. A key holds it by invoking its own root. A verifier resolves that root as
 * controlled by the signing key. The key doesn't hold another action under that root, since the invocation proves only
 * the key.
 */
export const DELEGATIONS_READ_ACTION = "Authority:readOwnDelegations";

/**
 * The capabilities on which a verified proof rests. `capabilities` lists the capabilities of its chain from the root
 * down. `expires` is the earliest expiry among them. `delegation` names the record of the delegation the proof presents,
 * the last of its chain, by the type the deployment records it as and its id. A call held open ends once one of these
 * capabilities is revoked or expires.
 */
export const RestsOnSchema = z.object({ capabilities: z.array(z.string()), expires: z.string().optional(), delegation: z.object({ label: z.string(), id: z.string() }) });
export type TRestsOn = z.infer<typeof RestsOnSchema>;
/** The chain a held call watches: its capabilities and its earliest expiry. */
export type TChain = Pick<TRestsOn, "capabilities" | "expires">;

/** A verifier's verdict. An `ok` verdict states the principal that proved the evidence, the actions the chain allows,
 *  the one action an invocation invoked, and `restsOn`. A verdict that isn't `ok` states why the verifier refused the
 *  evidence. */
export type TVerdict = { ok: true; principal?: string; allowedAction?: string[]; invoked?: string; restsOn?: TRestsOn } | { ok: false; error: string };

/**
 * Verifies whether evidence supports what it claims, and returns what it supports. A request's verdict lists every action
 * the presented delegation allows, and the action the request invokes among them. `delegationsTo` returns what this
 * deployment delegated to a key and hasn't revoked. The framework calls it only for the key a call proved it holds. A
 * consumer registers one verifier for the specification its deployment uses. The framework doesn't hold a signing key
 * and doesn't read a proof.
 */
export interface IAuthorityVerifier {
	verify(evidence: TAuthorityEvidence): Promise<TVerdict>;
	delegationsTo(controller: string): Promise<TDelegations>;
	/** Records a delegation, so the key it names can read it and a delegator above it can revoke it. It records a delegation
	 *  that `by` signed from a delegation `by` holds here, or any delegation that verifies for the root. */
	record(document: Record<string, unknown>, by: TActingFor): Promise<TAuthorityAct>;
	/** Records a capability's revocation. `by` may revoke a capability it signed or one below it, and the root may revoke
	 *  any capability. */
	revoke(capabilityId: string, by: TActingFor): Promise<TAuthorityAct>;
	/** Returns why a chain doesn't hold where one of its capabilities, or an ancestor of one, was revoked. Returns undefined
	 *  while each holds. */
	revokedIn(capabilities: readonly string[]): Promise<string | undefined>;
}

/** The principal of an authority act. It is the root where the caller holds every action, or else the key the caller
 *  proved. */
export type TActingFor = { root: true } | { root: false; controller: string };

/** The result of an authority act: the id of the record or revocation and its time, or the reason the authority refused the act. */
export type TAuthorityAct = { ok: true; id: string; at: string } | { ok: false; error: string };

/** A request this process sends, in the form a signature covers. A request such as a GET omits `body`. */
export type TOutgoingRequest = { method: string; url: string; headers: Record<string, string>; body?: string };

/** Signs a request that invokes `action` at the server that receives it. Returns the headers to send with the request.
 *  `delegator` is the key of a caller outside actuality for whom the request acts: the request presents only a delegation that
 *  key made to this process's key. Without `delegator` the request acts for actuality itself and presents this process's own
 *  delegation. */
export type TRequestSigner = (request: TOutgoingRequest, action: string, delegator?: string) => Promise<Record<string, string>>;

/** The refusal of a request that acts for `delegator` at `target` where that host didn't record a delegation of `action` from
 *  `delegator` to this process's key `key`. A step on another host doesn't run under this process's own delegation for a caller,
 *  so the caller delegates the action to this process's key. */
export const undelegatedRefusal = (delegator: string, action: string, target: string, key: string): TRpcRefusal => ({
	error: `${target} doesn't hold a delegation of ${action} from ${delegator} to this instance's key ${key}, and a step on another host runs for a caller only under the caller's delegation. Delegate ${action} at ${target} from ${delegator} to ${key}`,
	remedy: { do: "request", action },
});

/**
 * Signs a request this process sends. The request invokes an action at the server that receives it, under authority
 * this process holds. A consumer registers one invoker for the specification its deployment uses. The invoker determines
 * what the request presents, and the framework doesn't hold a key or determine that.
 */
export interface IAuthorityInvoker {
	sign: TRequestSigner;
}

/**
 * The authority a process holds. It holds the verifier a consumer registered for evidence from outside the process, and
 * the invoker a consumer registered to present this process's authority elsewhere.
 */
export interface IAuthority {
	registerVerifier(verifier: IAuthorityVerifier): void;
	registerInvoker(invoker: IAuthorityInvoker): void;
	/** Returns the registered verifier's delegations to a key. It reads them as the instance, and returns empty delegations
	 *  where a verifier isn't registered. */
	delegationsTo(controller: string): Promise<TDelegations>;
	signRequest: TRequestSigner;
	/** Returns whether a verifier is registered, so a boundary that reads a request determines whether to verify it. */
	hasVerifier(): boolean;
	verifyEvidence(evidence: TAuthorityEvidence): Promise<TVerdict>;
	/** Records a delegation for the call in progress. It reads and writes as the instance. */
	recordDelegation(document: Record<string, unknown>): Promise<TAuthorityAct>;
	/** Revokes a capability for the call in progress. It reads and writes as the instance. */
	revoke(capabilityId: string): Promise<TAuthorityAct>;
	/** Reports that a capability was revoked, so every call held open on it ends. Each code path that records a revocation calls this. */
	revoked(capabilityId: string): void;
	/** Returns a signal that aborts with the reason once a held call's `restsOn` lapses. It lapses where a capability it
	 *  names is revoked or its expiry passes. `release` stops watching, and is called when the call ends. */
	holdWhile(chain: TChain): { signal: AbortSignal; release(): void };
	/** Returns why `chain` doesn't hold now: its expiry passed, or one of its capabilities was revoked, as the revocation records
	 *  state at the time of the call. Returns undefined while the chain holds. A nested step's gate reads it. */
	lapsed(chain: TChain): Promise<string | undefined>;
	/** The number of calls held open on each capability. */
	heldCalls(): THeldCalls;
	clear(): void;
}

/** The domain of the calls an instance holds open. */
export const DOMAIN_HELD_CALLS = "held-calls";
/** The number of calls an instance holds open on each capability. Revoking a capability ends the calls held open on it. */
export const HeldCallsSchema = z.object({
	capabilities: z.array(z.object({ capability: z.string().describe("The capability's id."), calls: z.number().describe("How many calls rest on it.") })),
});
export type THeldCalls = z.infer<typeof HeldCallsSchema>;
