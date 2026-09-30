import { z } from "zod";
import type { AccessLevel } from "./resources.js";

/**
 * What authority means here, and no more than that: a step declares the action it requires, a caller presents evidence
 * of authority, and a verifier decides. Any particular authorization specification, and the verifier that reads it, is a
 * consumer's to register.
 *
 * Naming a specification here would mean the framework had chosen one for every consumer. It has not: what it declares
 * is the shape of a decision.
 */

/**
 * What a caller presents to act with authority it holds. In this process, that is the document carrying the authority,
 * and what the caller states it lets them do where it names one action; a document presented without one is checked for
 * everything it allows. Over HTTP, the request itself is the presentation: it names what is being
 * asked of what, and carries the proof that the caller may ask it. The verifier registered for the specification the
 * evidence is written in reads it; the framework never reads inside it.
 */
export type TAuthorityEvidence =
	| { kind: "document"; document: Record<string, unknown>; action?: string; target: string }
	| { kind: "request"; method: string; url: string; headers: Record<string, string | undefined>; body?: string };

/** Where a deployment records a delegation: the type of its record and the level the record is kept at, so a view opens
 *  the record only for a reader who may read it. */
export type TDelegationRecord = { persistedAs: string; accessLevel: AccessLevel };

/**
 * What was delegated to a key: the signed documents it presents, as the specification writes them, and the record the
 * deployment keeps of each, by the document's own `id`, so a holder can open what it acts under where it may read it.
 */
export type TDelegations = { delegations: Record<string, unknown>[]; records?: Record<string, TDelegationRecord> };

/** The step a key reads what was delegated to it with: core's AuthorityStepper's `delegationsTo`, which answers the key
 *  that signs the call. */
export const DELEGATIONS_READ_METHOD = "AuthorityStepper-delegationsTo";

/**
 * What the delegation read requires. A key holds it by invoking its own root, which a verifier resolves as controlled by
 * the key that signs, and doesn't hold another action under that root: all the invocation proves is the key.
 */
export const DELEGATIONS_READ_ACTION = "Authority:readOwnDelegations";

/**
 * What a verified proof rests on: the capabilities its chain descends through, root first, and the earliest time any of
 * them expires. A call held open for as long as its caller wants lasts only while each of these holds.
 */
export type TRestsOn = { capabilities: string[]; expires?: string };

/** A verifier's decision: where the evidence holds, who acted, what they may do, and what that rests on; where it
 *  doesn't, why it was refused. */
export type TVerdict = { ok: true; principal?: string; allowedAction?: string[]; restsOn?: TRestsOn } | { ok: false; error: string };

/**
 * Decides whether evidence supports what it claims, and states what it supports: for a request, everything the delegation
 * it presents allows, the action it invokes among them. It also answers what this deployment delegated to a key and
 * hasn't revoked, which the framework asks only for the key a call proved it holds. A consumer registers one for the specification its
 * deployment uses; the framework doesn't hold a signing key or read a proof itself.
 */
export interface IAuthorityVerifier {
	verify(evidence: TAuthorityEvidence): Promise<TVerdict>;
	delegationsTo(controller: string): Promise<TDelegations>;
	/** Record a delegation, so the key it names finds it and a delegator above it can revoke it: one `by` signed from a
	 *  delegation `by` holds here, or any that verifies for the root. */
	record(document: Record<string, unknown>, by: TActingFor): Promise<TAuthorityAct>;
	/** Record a capability's revocation: one `by` signed, or one below it, or any for the root. */
	revoke(capabilityId: string, by: TActingFor): Promise<TAuthorityAct>;
}

/** Who an act of the authority is done for: the root, for a caller holding every action, or the key a caller proved. */
export type TActingFor = { root: true } | { root: false; controller: string };

/** What the authority did: the id of what it recorded or revoked and when, or why it refused. */
export type TAuthorityAct = { ok: true; id: string; at: string } | { ok: false; error: string };

/** A request this process makes, as it is sent: what a signature over it covers. A request without a body, such as a GET,
 *  doesn't carry one. */
export type TOutgoingRequest = { method: string; url: string; headers: Record<string, string>; body?: string };

/** Signs a request that invokes `action` at the far side, answering the headers the request is sent with. */
export type TRequestSigner = (request: TOutgoingRequest, action: string) => Promise<Record<string, string>>;

/**
 * Signs a request this process makes, invoking an action under authority this process holds at the far side. A consumer
 * registers one for the specification its deployment uses, and it chooses what the request presents; the framework
 * doesn't hold a key or make that choice.
 */
export interface IAuthorityInvoker {
	sign: TRequestSigner;
}

/**
 * The authority a process holds: whatever verifier a consumer registered for evidence that comes from outside it, and
 * whatever invoker a consumer registered to present authority this process holds elsewhere.
 */
export interface IAuthority {
	registerVerifier(verifier: IAuthorityVerifier): void;
	registerInvoker(invoker: IAuthorityInvoker): void;
	/** What was delegated here to a key, read as the instance: empty, where a verifier that could verify a
	 *  delegation isn't registered. */
	delegationsTo(controller: string): Promise<TDelegations>;
	signRequest: TRequestSigner;
	/** Whether anything is registered to decide evidence at all, so a boundary reading a request knows to ask. */
	hasVerifier(): boolean;
	verifyEvidence(evidence: TAuthorityEvidence): Promise<TVerdict>;
	/** Record a delegation for the call in progress, read and written as the instance. */
	recordDelegation(document: Record<string, unknown>): Promise<TAuthorityAct>;
	/** Revoke a capability for the call in progress, read and written as the instance. */
	revoke(capabilityId: string): Promise<TAuthorityAct>;
	/** Report that a capability was revoked, so every call held open on it ends. Whatever records a revocation reports it. */
	revoked(capabilityId: string): void;
	/** A signal that aborts, with the reason, once what a held call rests on lapses: a capability it names is revoked, or
	 *  its expiry passes. `release` stops watching when the call ends. */
	holdWhile(restsOn: TRestsOn): { signal: AbortSignal; release(): void };
	/** The calls held open, by the capability each rests on. */
	heldCalls(): THeldCalls;
	clear(): void;
}

/** The domain of the calls an instance holds open. */
export const DOMAIN_HELD_CALLS = "held-calls";
/** The calls an instance holds open, by the capability each rests on: what revoking that capability ends. */
export const HeldCallsSchema = z.object({
	capabilities: z.array(z.object({ capability: z.string().describe("The capability's id."), calls: z.number().describe("How many calls rest on it.") })),
});
export type THeldCalls = z.infer<typeof HeldCallsSchema>;
