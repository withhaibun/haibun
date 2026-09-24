/**
 * A delegation this page gives, signed with its key from a delegation it holds: how the page gives a turn it asks what
 * the turn may do. zcap-LD narrows a delegation by the exact actions its parent lists, so for each action wanted the page
 * delegates the action its own delegation lists that allows it, and no delegation it gives outlasts the one it holds.
 * Every context the proof names is bundled, so signing never reaches the network.
 */
import jsigs from "jsonld-signatures";
import { CapabilityDelegation, constants as zcapConstants, extendDocumentLoader } from "@digitalbazaar/zcap";
import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite as ecdsaRdfc2019Cryptosuite } from "@digitalbazaar/ecdsa-rdfc-2019-cryptosuite";
import * as dataIntegrityContext from "@digitalbazaar/data-integrity-context";
import * as securityContext from "@digitalbazaar/security-context";
import * as multikeyContext from "@digitalbazaar/multikey-context";
import * as zcapContext from "@digitalbazaar/zcap-context";
import * as didContext from "did-context";
import { documentLoader, registerContext } from "@haibun/core/lib/jsonld-loader.js";
import { actionUnder, allowedActionFor, type TDelegation } from "@haibun/core/lib/actions.js";
import { pageAuthority, pageSigner } from "./page-key.js";

for (const bundled of [dataIntegrityContext, securityContext, multikeyContext, zcapContext, didContext])
	for (const [url, context] of bundled.contexts) registerContext(url, context);

/** What a delegation is given to and for: the key it names, the actions wanted, when it must end, and where it acts. */
type TDelegationTo = { controller: string; wanted: string[]; expires: string; target: string };

/** Sign a delegation from the first delegation this page holds that allows every action wanted at the target. */
export async function delegateFromPage(to: TDelegationTo): Promise<Record<string, unknown>> {
	const authority = pageAuthority();
	const signer = pageSigner();
	if (!authority || !signer) throw new Error("a page delegates once it has read what it holds, and this one hasn't");
	for (const parent of authority.delegations) {
		const listed = to.wanted.map((action) => actionUnder(parent, action, to.target));
		if (listed.some((action) => action === undefined)) continue;
		const allowedAction = allowedActionFor([...new Set(listed as string[])]);
		const document = {
			"@context": zcapConstants.ZCAP_CONTEXT_URL,
			id: `urn:uuid:${crypto.randomUUID()}`,
			controller: to.controller,
			parentCapability: String(parent.id),
			invocationTarget: String(parent.invocationTarget),
			...(allowedAction ? { allowedAction } : {}),
			expires: earlierOf(to.expires, parent),
		};
		const suite = new DataIntegrityProof({ signer: { id: signer.keyId, algorithm: "P-256", sign: signer.sign }, cryptosuite: ecdsaRdfc2019Cryptosuite });
		const purpose = new CapabilityDelegation({ parentCapability: parent, allowTargetAttenuation: true });
		return await jsigs.sign(document, { suite, purpose, documentLoader: extendDocumentLoader(documentLoader) });
	}
	throw new Error(`this page holds no delegation that allows everything the delegation it gives needs: ${to.wanted.join(", ")}`);
}

/** The earlier of when the delegation given was asked to end and when the one it narrows ends. */
function earlierOf(expires: string, parent: TDelegation): string {
	const parentEnds = typeof parent.expires === "string" ? parent.expires : undefined;
	return parentEnds && Date.parse(parentEnds) < Date.parse(expires) ? parentEnds : expires;
}
