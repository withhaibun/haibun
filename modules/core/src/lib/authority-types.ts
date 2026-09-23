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

/**
 * Decides whether evidence supports what it claims, and says what it supports. A consumer registers one for the
 * specification its deployment uses; the framework holds no signing key and reads no proof itself.
 */
export interface IAuthorityVerifier {
	verify(evidence: TAuthorityEvidence): Promise<{ ok: boolean; error?: string; principal?: string; allowedAction?: string[] }>;
}

/**
 * What a holder is asking to be given: a key it controls, the actions it may exercise with what it is given, and when
 * that lapses. The issuer registered for the deployment's specification decides what form the credential takes.
 */
export type TCredentialRequest = {
	/** The public half of the key the holder controls, as a JSON Web Key. The holder keeps the other half and sends it
	 *  nowhere; what form a credential names this key in is the issuing specification's business. */
	holderKey: Record<string, unknown>;
	/** What the credential allows, which is what the deployment declared this kind of holder may do. */
	allowedAction: string[];
	/** ISO 8601: authority that never lapses is authority nobody can withdraw by waiting. */
	expires: string;
	/** What the credential is over, so a holder cannot exercise it against something else. */
	target: string;
};

/** What an issuer answers with: the credential, the identifier of the key it names (what the holder signs as), and
 *  the principal it names as holding it (who acted, when a signature under that key is accepted). `record` is where
 *  the deployment wrote what it issued, when it keeps one: a holder can then reach what it acts under and read how it
 *  came to hold it, rather than holding a document that exists nowhere else. What kind of record that is belongs to
 *  the deployment, so it is named as a type and an identifier and read no further here. */
export type TIssuedCredential = {
	credential: Record<string, unknown>;
	keyId: string;
	controller: string;
	record?: { persistedAs: string; id: string };
};

/**
 * Issues a credential to a holder that proves control of a key. A consumer registers one for the specification its
 * deployment uses; the framework holds no signing key and writes no proof itself.
 */
export interface IAuthorityIssuer {
	issue(request: TCredentialRequest): Promise<TIssuedCredential>;
}

/** A request this process makes, as it is sent: what a signature over it covers. */
export type TOutgoingRequest = { method: string; url: string; headers: Record<string, string>; body: string };

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
 * The authority a process holds: whatever verifier a consumer registered for evidence that comes from outside it,
 * whatever issuer a consumer registered to give a holder something to present, and whatever invoker a consumer
 * registered to present authority this process holds elsewhere.
 */
export interface IAuthority {
	registerVerifier(verifier: IAuthorityVerifier): void;
	registerIssuer(issuer: IAuthorityIssuer): void;
	issueCredential(request: TCredentialRequest): Promise<TIssuedCredential>;
	registerInvoker(invoker: IAuthorityInvoker): void;
	signRequest: TRequestSigner;
	/** Whether anything is registered to decide evidence at all, so a boundary reading a request knows to ask. */
	hasVerifier(): boolean;
	verifyEvidence(evidence: TAuthorityEvidence): Promise<{ ok: boolean; error?: string; principal?: string; allowedAction?: string[] }>;
	clear(): void;
}
