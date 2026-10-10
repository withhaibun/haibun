/**
 * The page's hash, which every bundle on the page reads and writes, so a view in one bundle follows a hash a view in another
 * writes. The page holds its last canonical hash, which is the hash of a page that carries a record of actuality, the base an
 * `open=` arrival merges into, and a copy of the address's hash. The page follows arrivals from its first read of the hash.
 */
import { canonicalizeArrival, hashOf, hashParams } from "../derivations/address.js";
import type { TLocation } from "../ports.js";

/** What the page holds of its hash: the last canonical hash, the views that follow it, and the call that stops following
 *  arrivals, which is undefined until the first read. */
export type TPageHash = { stored: string; subscribers: Set<() => void>; stopArrivals: (() => void) | undefined };

/** What a read or write of the page's hash reads: the location, what the page holds, and whether the page carries a record
 *  of actuality, whose hash the page holds without an address to write. */
export type THashScope = { location: TLocation; held: TPageHash; carried: boolean };

/** Returns what the page holds of its hash, following arrivals from the first call on the page. The address the page opened
 *  at is its own merge base. */
function arrived({ location, held }: THashScope): TPageHash {
	if (held.stopArrivals !== undefined) return held;
	held.stored = canonicalizeArrival(location.hash(), location.hash());
	if (held.stored !== location.hash()) location.replaceHash(held.stored);
	held.stopArrivals = location.onHashArrival(() => {
		const at = location.hash();
		held.stored = canonicalizeArrival(at, held.stored);
		if (held.stored !== at) location.replaceHash(held.stored);
		announce(held);
	});
	return held;
}

const announce = (held: TPageHash): void => held.subscribers.forEach((listener) => listener());

/** Calls `listener` at each arrival at a hash and each write of one. Returns the call that stops it. A write through the
 *  history doesn't raise `hashchange`, and a page that carries a record doesn't raise either. */
export function onHashChanged(scope: THashScope, listener: () => void): () => void {
	const { subscribers } = arrived(scope);
	subscribers.add(listener);
	return () => subscribers.delete(listener);
}

/** Returns the page's hash. */
export const getHash = (scope: THashScope): string => (scope.carried ? arrived(scope).stored : scope.location.hash());

/** Writes `hash` as the page's hash, and doesn't call the views that follow it. */
export function pushHash(scope: THashScope, hash: string): void {
	arrived(scope).stored = hash;
	if (!scope.carried && scope.location.hash() !== hash) scope.location.replaceHash(hash);
}

/** Returns the value of the parameter `name` in the page's hash, or undefined where the hash doesn't state it. */
export function hashParam(scope: THashScope, name: string): string | undefined {
	const value = hashParams(getHash(scope)).get(name);
	return value === null ? undefined : value;
}

/** Sets each parameter of `values` in the page's hash, and keeps each other parameter. An undefined value removes its
 *  parameter. Each view that follows the hash is called where the hash changed. Throws for an empty value, which the hash doesn't
 *  distinguish from a removed parameter. */
export function mergeHashParams(scope: THashScope, values: Readonly<Record<string, string | undefined>>): void {
	const params = hashParams(getHash(scope));
	for (const [name, value] of Object.entries(values)) {
		if (value === "") throw new Error(`the hash parameter "${name}" is set to an empty value: a removed parameter is undefined`);
		if (value === undefined) params.delete(name);
		else params.set(name, value);
	}
	const next = hashOf(params);
	if (next === getHash(scope)) return;
	pushHash(scope, next);
	announce(arrived(scope));
}

/** Returns the page's address without the hash, which an embedded body's `<base>` resolves against, or undefined for a page
 *  that carries a record of actuality, which a site doesn't serve. */
export const pageAddress = (scope: THashScope): string | undefined => (scope.carried ? undefined : scope.location.address());
