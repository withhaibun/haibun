/**
 * ZCAP-LD types — exported vocabulary contract for any consumer.
 *
 * haibun-core itself implements only the bearer presentation; the signed
 * ZCAP-LD path is supplied by an `IZcapVerifier` that consumers register
 * with the authority — typically an adapter wrapping a ZCAP-LD library.
 *
 * Field names track the ZCAP-LD spec (id, controller, parentCapability,
 * invocationTarget, allowedAction, expires) so consumers and types match
 * the wire shape consumers parse from JSON-LD documents.
 */

/**
 * A capability grant. Bearer grants populate the unsigned subset (no proof,
 * no parentCapability); signed ZCAP-LD documents populate everything.
 */
export type TZcapGrant = {
	/** Capability id (URI/URN). For unsigned bearer grants, equal to token by default. */
	id: string;
	/** Bearer presentation token. Absent for purely signed grants that arrive via invocation only. */
	token?: string;
	/** Actions this capability authorizes. ZCAP-LD canonical: `string[]`. */
	allowedAction: string[];
	/** Identifier of the entity that controls this capability (signer / issuer). */
	controller?: string;
	/** Parent capability id, when this grant was delegated from another. */
	parentCapability?: string;
	/** Resource the capability authorizes action on (URI). */
	invocationTarget?: string;
	/** ISO/epoch creation timestamp. */
	created: number;
	/** Expiry — past value = revoked. */
	expires?: number;
	/** Set true once revoked (regardless of `expires`). */
	revoked: boolean;
	/** Free-form note for audit trails. */
	note?: string;
	/** Data Integrity proof block — present only on signed ZCAP-LD grants. */
	proof?: object;
};

/** A capability invocation request — what an invoker presents to exercise a capability. */
export type TZcapInvocation = {
	/** Capability id being invoked, or the inline capability document. */
	capability: string | TZcapGrant;
	/** Action being requested (must be in the capability's allowedAction list). */
	capabilityAction: string;
	/** Resource being acted on. */
	invocationTarget: string;
	/** Data Integrity proof binding the invocation to the invoker. */
	proof?: object;
};

/**
 * Pluggable verifier for signed ZCAP-LD invocations. haibun-core declares the
 * interface; consumers implement it against a ZCAP-LD library and register
 * the implementation with the authority.
 */
export interface IZcapVerifier {
	verify(invocation: TZcapInvocation, expected: { action: string; target: string; rootCapability?: string }): Promise<{ ok: boolean; error?: string }>;
}

/**
 * The authority interface — bearer presentation built into haibun-core,
 * signed verification delegated to a registered IZcapVerifier.
 */
export interface IZcapAuthority {
	issueBearerGrant(grant: { token: string; allowedAction: string[]; controller?: string; note?: string }): TZcapGrant;
	revokeBearerGrant(token: string, action?: string): number;
	resolveBearer(token: string): string[];
	listBearerGrants(): TZcapGrant[];
	registerVerifier(verifier: IZcapVerifier): void;
	verifySigned(invocation: TZcapInvocation, expected: { action: string; target: string; rootCapability?: string }): Promise<{ ok: boolean; error?: string }>;
	clear(): void;
}
