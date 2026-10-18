/** Signs a request as an invocation of a capability, as an HTTP signature (`http-signature-zcap-invoke`). */
/// <reference path="../../../http-signature-zcap-invoke.d.ts" />
import { signCapabilityInvocation } from "@digitalbazaar/http-signature-zcap-invoke";
import { carriedInSignature } from "@haibun/core/lib/domains/signature-header.js";
import type { TInvocationSigner } from "../ports.js";

/** Returns the invocation signer. */
export const httpInvocationSigner = (): TInvocationSigner => ({
	headers: async (request, capability, action, key) =>
		carriedInSignature(
			await signCapabilityInvocation({
				...request,
				...(capability === undefined ? {} : { capability }),
				capabilityAction: action,
				invocationSigner: { id: key.keyId, sign: key.sign },
			}),
		),
});
