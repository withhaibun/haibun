import type { ReactiveController, ReactiveControllerHost } from "lit";
import { PRINCIPAL_LABEL } from "@haibun/core/lib/resources.js";
import type { TSessionGrantShown } from "@haibun/core/steps/authority-stepper.js";
import { conduit } from "../hypermedia.js";
import { getAvailableSteps, findStep, requireStep } from "../rpc-registry.js";
import { session } from "../session-key.js";

/** A principal as a view reads one: its own id, and the key it signs with where it declares one. */
export type TPrincipalRow = { id: string; publicKey?: string };

/** What holds here: what this reader may do, who the deployment knows, and the grants its authority stands on. */
export type TAuthority = { holds: string[]; principals: TPrincipalRow[]; grants: TSessionGrantShown[] };

const WHY = "authority: what this reader may do";

/**
 * AuthorityController — the per-view handle to what authority stands here. A view that shows permissions HOLDS one and
 * calls `read()`; it never assembles the RPC itself.
 *
 * The grants come back without their tokens: a bearer token is the credential, so a listing carrying one would hand it
 * to whoever read the listing. What this reader holds is not asked for over the wire at all — it is in the credential
 * the page was served with, so a reader is told what they may do even when nothing may be read.
 */
export class AuthorityController implements ReactiveController {
	constructor(host: ReactiveControllerHost) {
		host.addController(this);
	}

	hostConnected(): void {} // read on demand, so a view that never opens its permissions asks nothing

	/** Break a grant by the name the listing gives it, which is not its credential. Immediate: the next call under it is
	 *  refused. Throws where this reader may not, so the view says what it was refused for. */
	async revoke(handle: string): Promise<void> {
		await getAvailableSteps();
		await conduit().follow({ method: requireStep("revokeSessionGrantByHandle"), params: { handle } }, `authority: revoke the grant named ${handle}`);
	}

	async read(): Promise<TAuthority> {
		await getAvailableSteps();
		const holds = session()?.allowedAction ?? [];
		const principals = await conduit().follow<{ vertices: TPrincipalRow[] }>({ method: requireStep("graphQuery"), params: { query: { label: PRINCIPAL_LABEL } } }, WHY);
		// A deployment whose authority reports nothing (no authority stepper registered) still says who it knows and what
		// this reader holds, so the view is a reading of what is there rather than an error.
		const listing = findStep("showSessionGrants");
		const grants = listing ? await conduit().follow<{ grants: TSessionGrantShown[] }>({ method: listing.method }, WHY) : { grants: [] };
		return { holds, principals: principals.vertices ?? [], grants: grants.grants ?? [] };
	}
}
