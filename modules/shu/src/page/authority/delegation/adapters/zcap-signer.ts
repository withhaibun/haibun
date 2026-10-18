/**
 * Signs a delegation the page gives as a zcap-LD capability with a Data Integrity proof (ecdsa-rdfc-2019). Every context
 * the proof names is bundled and registered at the first signature, so a signature doesn't reach the network.
 */
/// <reference path="../../../../zcap-signing.d.ts" />
import jsigs from "jsonld-signatures";
import { CapabilityDelegation, constants as zcapConstants, extendDocumentLoader } from "@digitalbazaar/zcap";
import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite as ecdsaRdfc2019Cryptosuite } from "@digitalbazaar/ecdsa-rdfc-2019-cryptosuite";
import * as dataIntegrityContext from "@digitalbazaar/data-integrity-context";
import * as securityContext from "@digitalbazaar/security-context";
import * as multikeyContext from "@digitalbazaar/multikey-context";
import * as zcapContext from "@digitalbazaar/zcap-context";
import * as didContext from "did-context";
import { documentLoader, registerContext } from "@haibun/core/lib/domains/jsonld-loader.js";
import type { TDelegationSigner } from "../ports.js";

/** Returns the delegation signer, which names the zcap-LD context in each delegation it signs. */
export function zcapDelegationSigner(): TDelegationSigner {
	let registered = false;
	return {
		sign: async (document, parent, key) => {
			if (!registered) {
				for (const bundled of [dataIntegrityContext, securityContext, multikeyContext, zcapContext, didContext])
					for (const [url, context] of bundled.contexts) registerContext(url, context);
				registered = true;
			}
			const suite = new DataIntegrityProof({ signer: { id: key.keyId, algorithm: "P-256", sign: key.sign }, cryptosuite: ecdsaRdfc2019Cryptosuite });
			const purpose = new CapabilityDelegation({ parentCapability: parent, allowTargetAttenuation: true });
			return await jsigs.sign({ "@context": zcapConstants.ZCAP_CONTEXT_URL, ...document }, { suite, purpose, documentLoader: extendDocumentLoader(documentLoader) });
		},
	};
}
