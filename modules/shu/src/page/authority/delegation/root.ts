/**
 * The composition root of the delegations the page gives. It holds the delegation signer, whose JSON-LD signature suite the
 * browser extension's background worker doesn't load, so it is apart from the authority area's root. The suite loads at the
 * page's first delegation, since a reader rarely delegates and the suite is a sixth of the page's bundle.
 */
import { pagePinned } from "../../adapters/page-held.js";
import type { TDelegationSigner } from "./ports.js";

const DELEGATIONS_KEY = "__SHU_DELEGATION_SIGNER__";

/** A signer that loads the signature suite at its first signature, and signs each delegation with it. */
function signerLoadedOnFirstUse(): TDelegationSigner {
	let loaded: Promise<TDelegationSigner> | undefined;
	return {
		sign: async (document, parent, key) => {
			loaded ??= import("./adapters/zcap-signer.js").then(({ zcapDelegationSigner }) => zcapDelegationSigner());
			return (await loaded).sign(document, parent, key);
		},
	};
}

/** Returns the page's delegation signer. */
export const pageDelegationSigner = (): TDelegationSigner => pagePinned(DELEGATIONS_KEY, signerLoadedOnFirstUse);
