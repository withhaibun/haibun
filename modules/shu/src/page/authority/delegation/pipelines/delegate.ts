/**
 * Signs a delegation the page gives from one it holds, which states what a turn the page sends may do. zcap-LD narrows a
 * delegation by the exact actions its parent lists, so for each requested action the page delegates the action of its own
 * delegation that allows it, and a delegation it gives expires at or before its parent's expiry.
 */
import { narrowing } from "@haibun/core/lib/actions.js";
import { pageAuthority, pageSigner, type TAuthorityScope } from "../../pipelines/page-authority.js";
import type { TDelegationSigner } from "../ports.js";

/** What a delegation names: the key that receives it, the requested actions, its expiry, and the address of its target. */
export type TDelegationTo = { controller: string; wanted: string[]; expires: string; target: string };

/** Signs a delegation from the first delegation the page holds that allows each requested action at the target. Throws for
 *  a page that hasn't read its delegations, and where the page doesn't hold such a delegation. */
export async function delegateFromPage(scope: TAuthorityScope, signer: TDelegationSigner, to: TDelegationTo): Promise<Record<string, unknown>> {
	const authority = pageAuthority(scope);
	const key = pageSigner(scope);
	if (authority === undefined || key === undefined) throw new Error("a page delegates once it has read what it holds, and this one hasn't");
	const narrowed = narrowing(authority.delegations, to);
	if (!narrowed) throw new Error(`this page doesn't hold a delegation that allows everything the delegation it gives needs: ${to.wanted.join(", ")}`);
	const { parent, allowedAction, expires } = narrowed;
	const document = {
		id: `urn:uuid:${crypto.randomUUID()}`,
		controller: to.controller,
		parentCapability: String(parent.id),
		invocationTarget: String(parent.invocationTarget),
		...(allowedAction ? { allowedAction } : {}),
		expires,
	};
	return await signer.sign(document, parent, key);
}
