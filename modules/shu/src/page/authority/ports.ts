/** The ports of the reader's authority on the page: its key, and the signatures it makes. */
import type { TDelegation } from "@haibun/core/lib/domains/actions.js";

/** The page's key pair: its public half as a JSON Web Key, and a signature with its private half, which isn't readable. */
export type TKeyPair = { publicJwk: JsonWebKey; sign(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> };

/** The page's own store: its key pair, and what it keeps beside it. */
export type TKeyStore = {
	/** Returns the key pair the page made, made and kept now where the store doesn't hold one. */
	keyPair(): Promise<TKeyPair>;
	/** Returns what the store holds under `name`, or undefined where it doesn't hold anything there. */
	read(name: string): Promise<unknown>;
	/** Keeps `value` under `name`. */
	keep(name: string, value: unknown): Promise<void>;
};

/** The page's key as it signs: its did:key, its verification method, and a signature over bytes. */
export type TSigningKey = { controller: string; keyId: string; sign(options: { data: Uint8Array<ArrayBuffer> }): Promise<Uint8Array> };

/** A request as its proof covers it: its absolute address, its method, its headers and its body where it has one. */
export type TProvedRequest = { url: string; method: string; headers: Record<string, string>; body?: string };

/** The signature of an invocation, which proves a request under a capability. */
export type TInvocationSigner = {
	/** Returns the headers that prove `request` as `action` under `capability`, signed by `key`. Without a capability, the
	 *  invocation is of the key's own root. */
	headers(request: TProvedRequest, capability: TDelegation | undefined, action: string, key: TSigningKey): Promise<Record<string, string>>;
};
