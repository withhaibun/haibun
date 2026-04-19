import type { TRuntime } from "./execution.js";

export const ZCAP_LIKE_AUTHORITY = "zcapLikeAuthority";

export type TZcapLikeGrant = {
	token: string;
	capability: string;
	revoked: boolean;
	issuedAt: number;
	revokedAt?: number;
	note?: string;
	issuer?: string;
};

export interface IZcapLikeAuthority {
	issueBearerGrant(grant: { token: string; capability: string; note?: string; issuer?: string }): TZcapLikeGrant;
	revokeBearerGrant(token: string, capability?: string): number;
	resolveBearerToken(token: string): string[];
	listBearerGrants(): TZcapLikeGrant[];
	clear(): void;
}

export class ZcapLikeAuthority implements IZcapLikeAuthority {
	private grants = new Map<string, TZcapLikeGrant[]>();

	issueBearerGrant(grant: { token: string; capability: string; note?: string; issuer?: string }): TZcapLikeGrant {
		const now = Date.now();
		const current = this.grants.get(grant.token) ?? [];
		const existing = current.find((entry) => entry.capability === grant.capability);
		if (existing) {
			existing.revoked = false;
			existing.issuedAt = now;
			existing.revokedAt = undefined;
			existing.note = grant.note;
			existing.issuer = grant.issuer;
			return existing;
		}
		const issued: TZcapLikeGrant = {
			token: grant.token,
			capability: grant.capability,
			revoked: false,
			issuedAt: now,
			note: grant.note,
			issuer: grant.issuer,
		};
		current.push(issued);
		this.grants.set(grant.token, current);
		return issued;
	}

	revokeBearerGrant(token: string, capability?: string): number {
		const entries = this.grants.get(token) ?? [];
		const now = Date.now();
		let revoked = 0;
		for (const entry of entries) {
			if (entry.revoked) continue;
			if (capability && entry.capability !== capability) continue;
			entry.revoked = true;
			entry.revokedAt = now;
			revoked += 1;
		}
		return revoked;
	}

	resolveBearerToken(token: string): string[] {
		return (this.grants.get(token) ?? []).filter((entry) => !entry.revoked).map((entry) => entry.capability);
	}

	listBearerGrants(): TZcapLikeGrant[] {
		return Array.from(this.grants.values()).flatMap((entries) => entries.map((entry) => ({ ...entry })));
	}

	clear(): void {
		this.grants.clear();
	}
}

export function getZcapLikeAuthority(runtime: TRuntime): IZcapLikeAuthority | undefined {
	return runtime[ZCAP_LIKE_AUTHORITY] as IZcapLikeAuthority | undefined;
}
