/**
 * The composition root of the reader's authority. It holds the page's key store, its invocation signer and what the page
 * holds, once per page, across its bundles. The composition that opens the page holds its invocation signer
 * (holdInvocationSigner): the page loads the signer's HTTP signature and gzip code at its first signed request, since a
 * page that holds a delegation signs one and a page that doesn't never does, and the browser extension's background
 * worker, which signs each request it relays, holds the signer at once. The worker loads this area alone, so it doesn't
 * import the page's root, whose views a worker doesn't load.
 */
import { pagePinned } from "../adapters/page-held.js";
import { browserKeyStore } from "./adapters/key-store.js";
import type { TInvocationSigner, TKeyStore } from "./ports.js";
import type { TAuthorityHeld, TAuthorityScope } from "./pipelines/page-authority.js";

const KEY_STORE_KEY = "__SHU_KEY_STORE__";
const INVOCATIONS_KEY = "__SHU_INVOCATION_SIGNER__";
const AUTHORITY_KEY = "__SHU_PAGE_AUTHORITY__";

/** Returns the page's key store. Throws outside a secure context, where the browser withholds one. */
export const pageKeyStore = (): TKeyStore => pagePinned(KEY_STORE_KEY, () => browserKeyStore());

/** Holds the page's invocation signer, as `make` makes it, where the page doesn't hold one yet, and returns the one it holds. */
export const holdInvocationSigner = (make: () => TInvocationSigner): TInvocationSigner => pagePinned(INVOCATIONS_KEY, make);

/** The page's invocation signer, as the composition that opened the page holds it. A request is signed only where a
 *  composition held a signer, so a signed request before one throws. */
const heldSigner = (): TInvocationSigner =>
	holdInvocationSigner(() => {
		throw new Error("the page signs a request before its composition holds an invocation signer: call holdInvocationSigner where the page opens");
	});

/** Returns what the page's authority reads and writes. */
export const authorityScope = (): TAuthorityScope => ({
	keys: pageKeyStore(),
	invocations: { headers: (request, capability, action, key) => heldSigner().headers(request, capability, action, key) },
	held: pagePinned(AUTHORITY_KEY, (): TAuthorityHeld => ({ key: undefined, held: undefined, opening: undefined })),
});
