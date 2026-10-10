/**
 * The composition root of the reader's authority. It holds the page's key store, its invocation signer and what the page
 * holds, once per page, across its bundles. The browser extension's background worker loads this area alone, so it doesn't import the
 * page's root, whose views a worker doesn't load.
 */
import { pagePinned } from "../adapters/page-held.js";
import { browserKeyStore } from "./adapters/key-store.js";
import { httpInvocationSigner } from "./adapters/invocation-signer.js";
import type { TInvocationSigner, TKeyStore } from "./ports.js";
import type { TAuthorityHeld, TAuthorityScope } from "./pipelines/page-authority.js";

const KEY_STORE_KEY = "__SHU_KEY_STORE__";
const INVOCATIONS_KEY = "__SHU_INVOCATION_SIGNER__";
const AUTHORITY_KEY = "__SHU_PAGE_AUTHORITY__";

/** Returns the page's key store. Throws outside a secure context, where the browser withholds one. */
export const pageKeyStore = (): TKeyStore =>
	pagePinned(KEY_STORE_KEY, () => browserKeyStore());

/** Returns what the page's authority reads and writes. */
export const authorityScope = (): TAuthorityScope => ({
	keys: pageKeyStore(),
	invocations: pagePinned(INVOCATIONS_KEY, (): TInvocationSigner => httpInvocationSigner()),
	held: pagePinned(AUTHORITY_KEY, (): TAuthorityHeld => ({ key: undefined, held: undefined, opening: undefined })),
});
