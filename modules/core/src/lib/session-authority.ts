/**
 * SessionAuthority — single capability authority for haibun.
 *
 * Two paths in one class:
 *   - Bearer presentation (built in): unsigned grants resolved by token. Used
 *     for in-process step-dispatch gating.
 *   - Signed ZCAP-LD (consumer-supplied): verifySigned delegates to a
 *     registered IAuthorityVerifier — typically an adapter wrapping a ZCAP-LD
 *     library. haibun-core stays crypto-free.
 *
 * Field/method naming tracks the ZCAP-LD spec (controller, allowedAction,
 * created, expires, parentCapability, invocationTarget) so consumers and the
 * authority speak the same vocabulary regardless of presentation form.
 */
import type { TRuntime } from "./world.js";
import type { IAuthority, IAuthorityVerifier, TSessionGrant, TAuthorityEvidence } from "./authority-types.js";

export const AUTHORITY_KEY = "authority";
/** Runtime key holding the active bearer token injected by `withToken`. */
export const SESSION_TOKEN_KEY = "sessionToken";
/** Runtime flag a trusted system actor sets to act without presenting evidence of authority. */
export const TRUSTED_CONTEXT = "trustedContext";

export class SessionAuthority implements IAuthority {
	private grants = new Map<string, TSessionGrant[]>();
	private verifier?: IAuthorityVerifier;

	issueSessionGrant(grant: { token: string; allowedAction: string[]; controller?: string; note?: string; expires?: number; seqPath?: string }): TSessionGrant {
		const now = Date.now();
		const current = this.grants.get(grant.token) ?? [];
		const existing = current.find((entry) => entry.controller === grant.controller);
		if (existing) {
			existing.allowedAction = [...new Set([...existing.allowedAction, ...grant.allowedAction])];
			existing.revoked = false;
			existing.created = now;
			existing.expires = grant.expires;
			existing.note = grant.note;
			existing.seqPath = grant.seqPath;
			return existing;
		}
		const issued: TSessionGrant = {
			id: grant.token,
			token: grant.token,
			...(grant.seqPath === undefined ? {} : { seqPath: grant.seqPath }),
			allowedAction: [...grant.allowedAction],
			controller: grant.controller,
			created: now,
			expires: grant.expires,
			revoked: false,
			note: grant.note,
		};
		current.push(issued);
		this.grants.set(grant.token, current);
		return issued;
	}

	revokeSessionGrant(token: string, action?: string): number {
		const entries = this.grants.get(token) ?? [];
		const now = Date.now();
		let revoked = 0;
		for (const entry of entries) {
			if (entry.revoked) continue;
			if (action) {
				if (!entry.allowedAction.includes(action)) continue;
				entry.allowedAction = entry.allowedAction.filter((a) => a !== action);
				if (entry.allowedAction.length === 0) {
					entry.revoked = true;
					entry.expires = now;
				}
				revoked += 1;
				continue;
			}
			entry.revoked = true;
			entry.expires = now;
			revoked += 1;
		}
		return revoked;
	}

	/** What a token allows now. A grant that has expired allows nothing, which is how a grant is bounded to a session
	 *  or to a period without anyone having to withdraw it. */
	resolveSession(token: string, now: number = Date.now()): string[] {
		const seen = new Set<string>();
		for (const entry of this.grants.get(token) ?? []) {
			if (entry.revoked) continue;
			if (entry.expires !== undefined && entry.expires <= now) continue;
			for (const action of entry.allowedAction) seen.add(action);
		}
		return [...seen];
	}

	resolveController(token: string): string | undefined {
		return this.grants.get(token)?.[0]?.controller;
	}

	listSessionGrants(): TSessionGrant[] {
		return [...this.grants.values()].flatMap((entries) => entries.map((entry) => ({ ...entry, allowedAction: [...entry.allowedAction] })));
	}

	registerVerifier(verifier: IAuthorityVerifier): void {
		this.verifier = verifier;
	}

	verifyEvidence(evidence: TAuthorityEvidence): Promise<{ ok: boolean; error?: string; principal?: string }> {
		if (!this.verifier) return Promise.resolve({ ok: false, error: "no verifier is registered to decide this evidence" });
		return this.verifier.verify(evidence);
	}

	clear(): void {
		this.grants.clear();
		this.verifier = undefined;
	}
}

export function getAuthority(runtime: TRuntime): IAuthority | undefined {
	return runtime.keys?.[AUTHORITY_KEY] as IAuthority | undefined;
}
