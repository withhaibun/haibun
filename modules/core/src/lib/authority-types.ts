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
 * What a caller presents to act with authority it holds. In this process, that is the document carrying the authority
 * and what the caller says it lets them do. Over HTTP, the request itself is the presentation: it names what is being
 * asked of what, and carries the proof that the caller may ask it. The verifier registered for the specification the
 * evidence is written in reads it; the framework never reads inside it.
 */
export type TAuthorityEvidence =
	| { kind: "document"; document: Record<string, unknown>; action: string; target: string }
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
 * the key that signs, and holds nothing else under that root: all the invocation proves is the key.
 */
export const DELEGATIONS_READ_ACTION = "Authority:readOwnDelegations";

/**
 * Decides whether evidence supports what it claims, and says what it supports: for a request, everything the delegation
 * it presents allows, the action it invokes among them. It also answers what this deployment delegated to a key and
 * hasn't revoked, which the framework asks only for the key a call proved it holds. A consumer registers one for the specification its
 * deployment uses; the framework holds no signing key and reads no proof itself.
 */
export interface IAuthorityVerifier {
	verify(evidence: TAuthorityEvidence): Promise<{ ok: boolean; error?: string; principal?: string; allowedAction?: string[] }>;
	delegationsTo(controller: string): Promise<TDelegations>;
}

/** A request this process makes, as it is sent: what a signature over it covers. A request with no body, such as a GET,
 *  carries none. */
export type TOutgoingRequest = { method: string; url: string; headers: Record<string, string>; body?: string };

/** Signs a request that invokes `action` at the far side, answering the headers the request is sent with. */
export type TRequestSigner = (request: TOutgoingRequest, action: string) => Promise<Record<string, string>>;

/**
 * Signs a request this process makes, invoking an action under authority this process holds at the far side. A consumer
 * registers one for the specification its deployment uses, and it chooses what the request presents; the framework
 * holds no key and chooses nothing.
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
	/** What was delegated here to a key, read as the instance: none, where nothing is registered that could verify a
	 *  delegation. */
	delegationsTo(controller: string): Promise<TDelegations>;
	signRequest: TRequestSigner;
	/** Whether anything is registered to decide evidence at all, so a boundary reading a request knows to ask. */
	hasVerifier(): boolean;
	verifyEvidence(evidence: TAuthorityEvidence): Promise<{ ok: boolean; error?: string; principal?: string; allowedAction?: string[] }>;
	clear(): void;
}
