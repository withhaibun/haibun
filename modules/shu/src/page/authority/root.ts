/**
 * The composition root of the reader's authority. It holds the page's key store, its invocation signer and what the page
 * holds, once per page, across its bundles. The invocation signer's HTTP signature and gzip code loads at the page's first
 * signed request, since a page that holds a delegation signs one and a page that doesn't never does. The browser extension's background worker loads this area alone, so it doesn't import the
 * page's root, whose views a worker doesn't load.
 */
import { loadedOnFirstUse, pagePinned } from "../adapters/page-held.js";
import { browserKeyStore } from "./adapters/key-store.js";
import type { TInvocationSigner, TKeyStore } from "./ports.js";
import type { TAuthorityHeld, TAuthorityScope } from "./pipelines/page-authority.js";

const KEY_STORE_KEY = "__SHU_KEY_STORE__";
const INVOCATIONS_KEY = "__SHU_INVOCATION_SIGNER__";
const AUTHORITY_KEY = "__SHU_PAGE_AUTHORITY__";

/** Returns the page's key store. Throws outside a secure context, where the browser withholds one. */
export const pageKeyStore = (): TKeyStore => pagePinned(KEY_STORE_KEY, () => browserKeyStore());

/** A signer that loads the HTTP signature code at its first signed request, and signs each request with it. */
function signerLoadedOnFirstUse(): TInvocationSigner {
	const signer = loadedOnFirstUse(() => import("./adapters/invocation-signer.js").then(({ httpInvocationSigner }) => httpInvocationSigner()));
	return { headers: async (request, capability, action, key) => (await signer()).headers(request, capability, action, key) };
}

/** Returns what the page's authority reads and writes. */
export const authorityScope = (): TAuthorityScope => ({
	keys: pageKeyStore(),
	invocations: pagePinned(INVOCATIONS_KEY, signerLoadedOnFirstUse),
	held: pagePinned(AUTHORITY_KEY, (): TAuthorityHeld => ({ key: undefined, held: undefined, opening: undefined })),
});
