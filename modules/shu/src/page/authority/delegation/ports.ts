/** The port of a delegation the page gives. */
import type { TDelegation } from "@haibun/core/lib/actions.js";
import type { TSigningKey } from "../ports.js";

/** The signature of a delegation the page gives from one it holds. */
export type TDelegationSigner = {
	/** Returns `document` signed by `key` as a delegation from `parent`, in the signature's context. */
	sign(document: Record<string, unknown>, parent: TDelegation, key: TSigningKey): Promise<Record<string, unknown>>;
};
