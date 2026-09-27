/**
 * The key a reader's page controls, and what was delegated to it here.
 *
 * The page makes its key pair once and keeps it in the browser's key store, where the private half is never readable
 * material, so the key outlives a reload and a delegation to it goes on holding. It names the key as a did:key, derived
 * from the key itself, which is what a holder delegates to. It reads what was delegated to that did:key here, proving
 * the key and nothing else, and signs each call with a delegation that allows what the call requires. No secret is sent or kept, and a delegation taken from
 * the page is of no use to whoever took it: they cannot sign with a key they don't hold.
 */
import { signCapabilityInvocation } from "@digitalbazaar/http-signature-zcap-invoke";
import { encode } from "base58-universal";
import { actionUnder, capabilityAllows, delegatedActions, type TDelegation } from "@haibun/core/lib/actions.js";
import { DELEGATIONS_READ_ACTION, type TDelegationRecord, type TDelegations } from "@haibun/core/lib/authority-types.js";
import { pagePinned } from "./page-pinned.js";

/** What a reader's page holds here: its key, named as a did:key, and what was delegated to that key. */
export type TPageAuthority = {
	/** The page's key as a did:key: what a holder delegates to. */
	controller: string;
	/** What was delegated here to that key, as the documents it presents. */
	delegations: TDelegation[];
	/** The record the deployment keeps of each delegation, by its id, so a view opens one where the page may read it. */
	records?: Record<string, TDelegationRecord>;
	/** What every reader may do here without a delegation, as the deployment declares. */
	withoutDelegation: string[];
};

/** The page's key as it signs: its did:key, its verification method, and a signature over bytes. */
type TSigningKey = { controller: string; keyId: string; sign(options: { data: Uint8Array }): Promise<Uint8Array> };

// A reader is one reader across every bundle of its page, so what it holds is the page's, and so is the reading of it: a
// bundle that signs a request waits on the reading the app started rather than starting one of its own.
const PAGE_AUTHORITY_KEY = "__SHU_PAGE_AUTHORITY__";
const pinned = (): { key?: TSigningKey; held?: { authority: TPageAuthority; key: TSigningKey }; opening?: Promise<TPageAuthority> } => pagePinned(PAGE_AUTHORITY_KEY, () => ({}));

const KEY_DB = "haibun-page-key";
const KEY_STORE = "keys";
const PAGE_KEY = "page";
/** The multicodec prefix of a P-256 public key, as a did:key names one: 0x1200 as an unsigned varint. */
const P256_PUBLIC = [0x80, 0x24];

/**
 * The key this page signs with: the one it made before, from the browser's key store, or one made now and kept there.
 * Its private half is not readable material, so what a reader sends is a signature rather than anything that could be
 * taken and reused.
 */
async function pageKey(): Promise<TSigningKey> {
	// A browser gives a page its key store only in a secure context: over https, or from localhost. Served otherwise
	// there is no key for a reader to control and nothing it could prove, which is a fact about how the deployment is
	// reached rather than a fault in the page, so it is said as that.
	if (!globalThis.crypto?.subtle) {
		throw new Error(
			`a reader can only make a key it controls in a secure context (https, or localhost); this page was served from ${globalThis.location?.origin ?? "an origin"}, where the browser withholds its key store`,
		);
	}
	if (typeof indexedDB === "undefined") throw new Error("a reader's page keeps its key in the browser's IndexedDB, which this page doesn't have");
	const pair = await keptPair();
	return {
		...didKeyOf(await crypto.subtle.exportKey("jwk", pair.publicKey)),
		sign: async ({ data }) => new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data as unknown as BufferSource)),
	};
}

/** The page's key pair from the key store, made and kept there the first time. */
async function keptPair(): Promise<CryptoKeyPair> {
	const kept = await readKept<CryptoKeyPair>(PAGE_KEY);
	if (kept) return kept;
	const made = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
	await keep(PAGE_KEY, made);
	return made;
}

/** What the page keeps in its own store under `name`: its key pair, or what it gives the turns it asks. */
export function readKept<T>(name: string): Promise<T | undefined> {
	return withKeyDb((db) => request<T | undefined>(db.transaction(KEY_STORE).objectStore(KEY_STORE).get(name)));
}

/** Keep `value` in the page's own store under `name`. */
export async function keep(name: string, value: unknown): Promise<void> {
	await withKeyDb((db) => request(db.transaction(KEY_STORE, "readwrite").objectStore(KEY_STORE).put(value, name)));
}

/** The connection is closed once used, since what it read is usable without it, and a connection a page holds open slows
 *  every other store it reads. */
async function withKeyDb<T>(use: (db: IDBDatabase) => Promise<T>): Promise<T> {
	const db = await openKeyDb();
	try {
		return await use(db);
	} finally {
		db.close();
	}
}

function openKeyDb(): Promise<IDBDatabase> {
	const opening = indexedDB.open(KEY_DB, 1);
	opening.onupgradeneeded = () => opening.result.createObjectStore(KEY_STORE);
	return request(opening);
}

function request<T>(asked: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		asked.onsuccess = () => resolve(asked.result);
		asked.onerror = () => reject(asked.error);
	});
}

/** A P-256 public key named as a did:key, and the verification method its signatures are made as. */
export function didKeyOf(jwk: JsonWebKey): { controller: string; keyId: string } {
	const fingerprint = `z${encode(new Uint8Array([...P256_PUBLIC, ...compressedPoint(jwk)]))}`;
	const controller = `did:key:${fingerprint}`;
	return { controller, keyId: `${controller}#${fingerprint}` };
}

/** A P-256 public key as its compressed point: the parity of y, then x. */
function compressedPoint(jwk: JsonWebKey): Uint8Array {
	if (!jwk.x || !jwk.y) throw new Error("the page's public key doesn't have the coordinates to name it by");
	const bytes = (b64url: string) => Uint8Array.from(atob(b64url.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
	const y = bytes(jwk.y);
	return new Uint8Array([y[y.length - 1] & 1 ? 0x03 : 0x02, ...bytes(jwk.x)]);
}

/**
 * Read what this page holds here: its key, and what `read` answers was delegated to it. `read` is the call to the
 * deployment's delegation read, which the page signs with `keyHeaders`, or undefined where the deployment verifies no
 * delegation, which leaves the page what needs none.
 */
export function openPageAuthority(read: (() => Promise<TDelegations>) | undefined, withoutDelegation: string[]): Promise<TPageAuthority> {
	const opening = (async () => {
		const key = await pageKey();
		pinned().key = key;
		const delegated = read ? await read() : { delegations: [] };
		const authority = { controller: key.controller, delegations: delegated.delegations, records: delegated.records, withoutDelegation };
		pinned().held = { authority, key };
		return authority;
	})();
	pinned().opening = opening;
	return opening;
}

/**
 * What this page holds, once the reading the page started is done. A page that never started one has nothing to wait
 * for, and a reading that failed fails here, at the call that needed it, rather than as a reader silently able to do
 * nothing.
 */
export async function pageAuthorityReady(): Promise<TPageAuthority | undefined> {
	return await pinned().opening;
}

/** What this page holds, where it has been read. */
export function pageAuthority(): TPageAuthority | undefined {
	return pinned().held?.authority;
}

/** The key this page signs as, once it has read what it holds: what signs a delegation it gives. */
export function pageSigner(): TSigningKey | undefined {
	return pinned().held?.key;
}

/** Every action this page holds: what needs no delegation here, and what its delegations list. */
export function pageHolds(authority = pageAuthority()): string[] {
	if (!authority) return [];
	return [...new Set([...authority.withoutDelegation, ...authority.delegations.flatMap(delegatedActions)])];
}

/**
 * Hold a delegation another page gave this page's key, in place of `replacing`, the one it gave before: the page that
 * embeds this one delegates to its key and renews that delegation before it expires. A delegation to another key is
 * refused.
 */
export function holdGiven(delegation: TDelegation, replacing?: TDelegation): void {
	const pin = pinned();
	if (!pin.held) throw new Error("a page holds a delegation it is given once it has read what it holds, and this one hasn't");
	const { authority } = pin.held;
	if (delegation.controller !== authority.controller) throw new Error(`the delegation is to ${String(delegation.controller)}, and this page's key is ${authority.controller}`);
	const holding = { ...authority, delegations: [delegation, ...authority.delegations.filter((held) => held !== replacing)] };
	pin.held = { ...pin.held, authority: holding };
	pin.opening = Promise.resolve(holding);
}

/** Whether this page holds what `action` requires. */
export function pageMay(action: string): boolean {
	return capabilityAllows(pageHolds(), action);
}

/** Forget what this page holds, so it is read again: its key stays in the key store. */
export function forgetPageAuthority(): void {
	pinned().key = undefined;
	pinned().held = undefined;
	pinned().opening = undefined;
}

/**
 * The headers that prove this page may ask this, of this: signed with its key under a delegation that allows `action`
 * at the address asked, over the address, the method and the body where it has one, so what is proven is the request
 * rather than possession of anything. Undefined where no delegation allows it, and the call is sent as it is, which the
 * deployment may allow without a delegation.
 */
/**
 * The headers that prove this page holds its key, and nothing more: an invocation of the key's own root, which the
 * deployment resolves as controlled by whoever signs it and which allows only the delegation read. It is how the page
 * learns what else it holds, so it is signed before the page holds anything.
 */
export async function keyHeaders(request: { url: string; method: string; headers: Record<string, string>; body?: string }): Promise<Record<string, string>> {
	const key = pinned().key;
	if (!key) throw new Error("the page proves its key while it reads what was delegated to it, and it isn't reading");
	return await signCapabilityInvocation({ ...request, capabilityAction: DELEGATIONS_READ_ACTION, invocationSigner: { id: key.keyId, sign: key.sign } });
}

/** The headers a page asks for `url` with by GET: signed under a delegation that allows `action`, where it holds one, and
 *  none otherwise, which the deployment may allow without a delegation. */
export async function readingHeaders(url: string, action: string): Promise<Record<string, string>> {
	await pageAuthorityReady();
	const asked = new URL(url, location.href);
	return (await signedHeaders({ url: asked.toString(), method: "GET", headers: { host: asked.host }, action })) ?? {};
}

export async function signedHeaders(request: {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
	action: string;
}): Promise<Record<string, string> | undefined> {
	const held = pinned().held;
	if (!held) return undefined;
	const asked = new URL(request.url);
	const target = asked.origin + asked.pathname;
	for (const delegation of held.authority.delegations) {
		const invoked = actionUnder(delegation, request.action, target);
		if (!invoked) continue;
		return await signCapabilityInvocation({
			url: request.url,
			method: request.method,
			headers: request.headers,
			body: request.body,
			capability: delegation,
			capabilityAction: invoked,
			invocationSigner: { id: held.key.keyId, sign: held.key.sign },
		});
	}
	return undefined;
}
