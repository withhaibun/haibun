/** The page's invocation signer, which loads the HTTP signature and gzip code at the page's first signed request. In a
 *  single-file bundle the code is already present, and the load resolves without a fetch. */
import { loadedOnFirstUse } from "../../adapters/page-held.js";
import type { TInvocationSigner } from "../ports.js";

/** Returns a signer that loads the HTTP signature code at its first signed request, and signs each request with it. */
export function signerLoadedOnFirstUse(): TInvocationSigner {
	const signer = loadedOnFirstUse(() => import("./invocation-signer.js").then(({ httpInvocationSigner }) => httpInvocationSigner()));
	return { headers: async (request, capability, action, key) => (await signer()).headers(request, capability, action, key) };
}
