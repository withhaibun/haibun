/**
 * What authority means here, and no more than that: a step declares the action it requires, a caller presents evidence
 * of authority, and a verifier decides. The framework implements one verifier itself, over the session credential a
 * process holds; anything else, including any particular authorization specification, is a consumer's to register.
 *
 * Naming a specification here would mean the framework had chosen one for every consumer. It has not: what it declares
 * is the shape of a decision.
 */

/**
 * What a session may do while it holds a grant: the actions it was given, who it acts as, and when it stops holding
 * them. This is the framework's own credential, issued by a process to itself and never leaving it.
 */
export type TSessionGrant = {
	/** The grant's identifier, which for a session credential is the token it is presented with. */
	id: string;
	/** The token a caller presents to act under this grant. */
	token?: string;
	/** What the holder may do. */
	allowedAction: string[];
	/** Who the holder acts as, so what a step under this grant writes is attributed to them. */
	controller?: string;
	/** When the grant was issued. */
	created: number;
	/** When it stops holding, if it does. A past value has already stopped. */
	expires?: number;
	/** Withdrawn, whether or not it had an expiry. */
	revoked: boolean;
	/** What it was granted for, for a reader of the record. */
	note?: string;
	/** The step it was granted at, so a reader can open what granted it. */
	seqPath?: string;
};

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
 *  the principal it names as holding it (who acted, when a signature under that key is accepted). */
export type TIssuedCredential = { credential: Record<string, unknown>; keyId: string; controller: string };

/**
 * Issues a credential to a holder that proves control of a key. A consumer registers one for the specification its
 * deployment uses; the framework holds no signing key and writes no proof itself.
 */
export interface IAuthorityIssuer {
	issue(request: TCredentialRequest): Promise<TIssuedCredential>;
}

/**
 * The authority a process holds: its own session grants, whatever verifier a consumer registered for evidence that
 * comes from outside it, and whatever issuer a consumer registered to give a holder something to present.
 */
export interface IAuthority {
	issueSessionGrant(grant: { token: string; allowedAction: string[]; controller?: string; note?: string; expires?: number; seqPath?: string }): TSessionGrant;
	revokeSessionGrant(token: string, action?: string): number;
	resolveSession(token: string): string[];
	resolveController(token: string): string | undefined;
	listSessionGrants(): TSessionGrant[];
	registerVerifier(verifier: IAuthorityVerifier): void;
	registerIssuer(issuer: IAuthorityIssuer): void;
	issueCredential(request: TCredentialRequest): Promise<TIssuedCredential>;
	/** Whether anything is registered to decide evidence at all, so a boundary reading a request knows to ask. */
	hasVerifier(): boolean;
	verifyEvidence(evidence: TAuthorityEvidence): Promise<{ ok: boolean; error?: string; principal?: string; allowedAction?: string[] }>;
	clear(): void;
}
