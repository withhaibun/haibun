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
 * What a caller presents to act with authority it holds: the document that carries that authority, in whatever
 * specification it is written, and what the caller claims it lets them do. The verifier registered for that
 * specification reads the document and decides; the framework never reads inside it.
 */
export type TAuthorityEvidence = {
	/** The authority itself, as its own document. */
	document: Record<string, unknown>;
	/** What the caller is asking to do. */
	action: string;
	/** What the caller is asking to do it to. */
	target: string;
};

/**
 * Decides whether evidence supports what it claims. A consumer registers one for the specification its deployment
 * uses; the framework holds no signing key and reads no proof itself.
 */
export interface IAuthorityVerifier {
	verify(evidence: TAuthorityEvidence): Promise<{ ok: boolean; error?: string; principal?: string }>;
}

/**
 * The authority a process holds: its own session grants, and whatever verifier a consumer registered for evidence
 * that comes from outside it.
 */
export interface IAuthority {
	issueSessionGrant(grant: { token: string; allowedAction: string[]; controller?: string; note?: string; expires?: number; seqPath?: string }): TSessionGrant;
	revokeSessionGrant(token: string, action?: string): number;
	resolveSession(token: string): string[];
	resolveController(token: string): string | undefined;
	listSessionGrants(): TSessionGrant[];
	registerVerifier(verifier: IAuthorityVerifier): void;
	verifyEvidence(evidence: TAuthorityEvidence): Promise<{ ok: boolean; error?: string; principal?: string }>;
	clear(): void;
}
