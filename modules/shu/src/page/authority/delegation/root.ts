/**
 * The composition root of the delegations the page gives. It holds the delegation signer, whose JSON-LD signature suite the
 * browser extension's background worker doesn't load, so it is apart from the authority area's root.
 */
import { pagePinned } from "../../adapters/page-held.js";
import { zcapDelegationSigner } from "./adapters/zcap-signer.js";
import type { TDelegationSigner } from "./ports.js";

const DELEGATIONS_KEY = "__SHU_DELEGATION_SIGNER__";

/** Returns the page's delegation signer. */
export const pageDelegationSigner = (): TDelegationSigner => pagePinned(DELEGATIONS_KEY, () => zcapDelegationSigner());
