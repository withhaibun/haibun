/**
 * What a reader's page holds here: its key, named as a did:key, and what was delegated to that key. The page reads its
 * delegations proving the key alone, and signs each call with a delegation that allows what the call requires. The page
 * doesn't send or keep a secret, and a delegation taken from the page doesn't serve whoever took it, since a signature
 * needs the key.
 */
import { actionUnder, capabilityAllows, delegatedActions, type TDelegation } from "@haibun/core/lib/actions.js";
import { DELEGATIONS_READ_ACTION, DELEGATIONS_READ_METHOD, type TDelegationRecord, type TDelegations } from "@haibun/core/lib/authority-types.js";
import type { TProveRequest } from "@haibun/core/lib/rpc-wire.js";
import { didKeyOf } from "../derivations/did-key.js";
import type { TInvocationSigner, TKeyStore, TProvedRequest, TSigningKey } from "../ports.js";

/** What a reader's page holds here: its key, named as a did:key, and what was delegated to that key. */
export type TPageAuthority = {
	/** The page's key as a did:key, which a holder's delegation names. */
	controller: string;
	/** What was delegated here to that key, as the documents it presents. */
	delegations: TDelegation[];
	/** The record the deployment keeps of each delegation, by its id, or undefined where the deployment doesn't verify a
	 *  delegation. */
	records: Record<string, TDelegationRecord> | undefined;
	/** What every reader may do here without a delegation, as the deployment declares. */
	withoutDelegation: string[];
};

/** What the page holds of its authority, across its bundles: its key while it reads its delegations, what it holds once it
 *  read them, and the read under way. A bundle that signs a request waits on the read the page started. */
export type TAuthorityHeld = { key: TSigningKey | undefined; held: { authority: TPageAuthority; key: TSigningKey } | undefined; opening: Promise<TPageAuthority> | undefined };

/** What the page's authority reads and writes: its key store, its invocation signer, and what it holds. */
export type TAuthorityScope = { keys: TKeyStore; invocations: TInvocationSigner; held: TAuthorityHeld };

/** Returns the page's key as it signs. */
async function signingKey(keys: TKeyStore): Promise<TSigningKey> {
	const pair = await keys.keyPair();
	return { ...didKeyOf(pair.publicJwk), sign: ({ data }) => pair.sign(data) };
}

/** Reads what the page holds here: its key, and what `read` returns as delegated to it. `read` is the call of the
 *  deployment's delegation read, which the page signs with `keyHeaders`, or undefined where the deployment doesn't verify a
 *  delegation, which leaves the page what doesn't need one. */
export function openPageAuthority({ keys, held }: TAuthorityScope, read: (() => Promise<TDelegations>) | undefined, withoutDelegation: string[]): Promise<TPageAuthority> {
	const opening = (async () => {
		const key = await signingKey(keys);
		held.key = key;
		const delegated: TDelegations = read === undefined ? { delegations: [] } : await read();
		const authority: TPageAuthority = { controller: key.controller, delegations: delegated.delegations, records: delegated.records, withoutDelegation };
		held.held = { authority, key };
		return authority;
	})();
	held.opening = opening;
	return opening;
}

/** Returns what the page holds once the read the page started ends, or undefined where the page didn't start one. A read that
 *  failed fails here, at the call that needs it. */
export const pageAuthorityReady = ({ held }: TAuthorityScope): Promise<TPageAuthority | undefined> => (held.opening === undefined ? Promise.resolve(undefined) : held.opening);

/** Returns what the page holds, or undefined until it read it. */
export const pageAuthority = ({ held }: TAuthorityScope): TPageAuthority | undefined => held.held?.authority;

/** Returns the key the page signs as once it read what it holds, or undefined until then. */
export const pageSigner = ({ held }: TAuthorityScope): TSigningKey | undefined => held.held?.key;

/** Returns each action the page holds: what doesn't need a delegation here, and what its delegations list. A page that
 *  hasn't read what it holds returns an empty list. */
export function pageHolds(scope: TAuthorityScope): string[] {
	const authority = pageAuthority(scope);
	if (authority === undefined) return [];
	return [...new Set([...authority.withoutDelegation, ...authority.delegations.flatMap(delegatedActions)])];
}

/** Whether the page holds what `action` requires. */
export const pageMay = (scope: TAuthorityScope, action: string): boolean => capabilityAllows(pageHolds(scope), action);

/** Holds a delegation the embedding page gave the page's key, in place of `replacing`, the one it gave before, or beside
 *  what the page holds where `replacing` is undefined. Throws for a delegation to another key, and for a page that hasn't
 *  read what it holds. */
export function holdGiven({ held }: TAuthorityScope, delegation: TDelegation, replacing: TDelegation | undefined): void {
	const current = held.held;
	if (current === undefined) throw new Error("a page holds a delegation it is given once it has read what it holds, and this one hasn't");
	const { authority } = current;
	if (delegation.controller !== authority.controller) throw new Error(`the delegation is to ${String(delegation.controller)}, and this page's key is ${authority.controller}`);
	const holding = { ...authority, delegations: [delegation, ...authority.delegations.filter((given) => given !== replacing)] };
	held.held = { ...current, authority: holding };
	held.opening = Promise.resolve(holding);
}

/** Lets go of what the page holds, so it reads it again. The key stays in the key store. */
export function forgetPageAuthority({ held }: TAuthorityScope): void {
	held.key = undefined;
	held.held = undefined;
	held.opening = undefined;
}

/** Returns the headers that prove only that the page holds its key: an invocation of the key's own root, which the
 *  deployment resolves as controlled by whoever signs it, and which allows only the delegation read. Throws outside the
 *  read of the page's delegations. */
export async function keyHeaders({ held, invocations }: TAuthorityScope, request: TProvedRequest): Promise<Record<string, string>> {
	if (held.key === undefined) throw new Error("the page proves its key while it reads what was delegated to it, and it isn't reading");
	return await invocations.headers(request, undefined, DELEGATIONS_READ_ACTION, held.key);
}

/** Returns the headers that prove `request` as `action`, signed with the page's key under the first delegation that allows
 *  the action at the request's address, or undefined where the page doesn't hold one, and the call goes as it is, which
 *  the deployment may allow without a delegation. */
export async function signedHeaders({ held, invocations }: TAuthorityScope, request: TProvedRequest & { action: string }): Promise<Record<string, string> | undefined> {
	const current = held.held;
	if (current === undefined) return undefined;
	const asked = new URL(request.url);
	const target = asked.origin + asked.pathname;
	const { action, ...proved } = request;
	for (const delegation of current.authority.delegations) {
		const invoked = actionUnder(delegation, action, target);
		if (invoked) return await invocations.headers(proved, delegation, invoked, current.key);
	}
	return undefined;
}

/** Returns the headers of a GET of the absolute address `url` as `action`: signed under a delegation that allows `action`
 *  where the page holds one, once the page read what it holds, and empty otherwise, which the deployment may allow without
 *  a delegation. */
export async function readingHeaders(scope: TAuthorityScope, url: string, action: string): Promise<Record<string, string>> {
	await pageAuthorityReady(scope);
	const signed = await signedHeaders(scope, { url, method: "GET", headers: { host: new URL(url).host }, action });
	return signed === undefined ? {} : signed;
}

/**
 * Returns how a call of `method` is proven, where the call requires `required`, or undefined where the registry doesn't
 * name an action the step requires. The read of the page's delegations proves the key alone, since the page reads its
 * delegations through it. A call that requires an action waits for the page's authority, and is signed under a delegation
 * that allows the action. A call for which the page doesn't hold a delegation carries its headers as they are, and the
 * deployment may allow it without one.
 */
export function callProof(scope: TAuthorityScope, method: string, required: string | undefined): TProveRequest {
	return async (request) => {
		if (method === DELEGATIONS_READ_METHOD) return await keyHeaders(scope, request);
		if (required === undefined) return request.headers;
		await pageAuthorityReady(scope);
		const signed = await signedHeaders(scope, { ...request, action: required });
		return signed === undefined ? request.headers : signed;
	};
}
