/**
 * ZcapAuthority — single capability authority for haibun.
 *
 * Two paths in one class:
 *   - Bearer presentation (built in): unsigned grants resolved by token. Used
 *     for in-process step-dispatch gating.
 *   - Signed ZCAP-LD (consumer-supplied): verifySigned delegates to a
 *     registered IZcapVerifier — typically a spopg-side adapter wrapping
 *     `@digitalbazaar/zcap`. haibun-core stays crypto-free.
 *
 * Field/method naming tracks the ZCAP-LD spec (controller, allowedAction,
 * created, expires, parentCapability, invocationTarget) so consumers and the
 * authority speak the same vocabulary regardless of presentation form.
 */
import type { TRuntime } from "./world.js";
import type { IZcapAuthority, IZcapVerifier, TZcapGrant, TZcapInvocation } from "./zcap-types.js";

export const ZCAP_AUTHORITY = "zcapAuthority";
/** Runtime key holding the active bearer token injected by `withToken`. */
export const ZCAP_TOKEN_KEY = "zcapToken";
/** Runtime flag set by trusted system actors (e.g. AutonomicStepper) to bypass ZCAP checks. */
export const TRUSTED_CONTEXT = "zcapTrustedContext";

export class ZcapAuthority implements IZcapAuthority {
	private grants = new Map<string, TZcapGrant[]>();
	private verifier?: IZcapVerifier;

	issueBearerGrant(grant: { token: string; allowedAction: string[]; controller?: string; note?: string }): TZcapGrant {
		const now = Date.now();
		const current = this.grants.get(grant.token) ?? [];
		const existing = current.find((entry) => entry.controller === grant.controller);
		if (existing) {
			existing.allowedAction = [...new Set([...existing.allowedAction, ...grant.allowedAction])];
			existing.revoked = false;
			existing.created = now;
			existing.expires = undefined;
			existing.note = grant.note;
			return existing;
		}
		const issued: TZcapGrant = {
			id: grant.token,
			token: grant.token,
			allowedAction: [...grant.allowedAction],
			controller: grant.controller,
			created: now,
			revoked: false,
			note: grant.note,
		};
		current.push(issued);
		this.grants.set(grant.token, current);
		return issued;
	}

	revokeBearerGrant(token: string, action?: string): number {
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

	resolveBearer(token: string): string[] {
		const seen = new Set<string>();
		for (const entry of this.grants.get(token) ?? []) {
			if (entry.revoked) continue;
			for (const action of entry.allowedAction) seen.add(action);
		}
		return [...seen];
	}

	listBearerGrants(): TZcapGrant[] {
		return [...this.grants.values()].flatMap((entries) => entries.map((entry) => ({ ...entry, allowedAction: [...entry.allowedAction] })));
	}

	registerVerifier(verifier: IZcapVerifier): void {
		this.verifier = verifier;
	}

	verifySigned(invocation: TZcapInvocation, expected: { action: string; target: string; rootCapability?: string }): Promise<{ ok: boolean; error?: string }> {
		if (!this.verifier) return Promise.resolve({ ok: false, error: "no verifier registered" });
		return this.verifier.verify(invocation, expected);
	}

	clear(): void {
		this.grants.clear();
		this.verifier = undefined;
	}
}

export function getZcapAuthority(runtime: TRuntime): IZcapAuthority | undefined {
	return runtime[ZCAP_AUTHORITY] as IZcapAuthority | undefined;
}
