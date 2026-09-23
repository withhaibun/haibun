import type { ReactiveController, ReactiveControllerHost } from "lit";
import { Access, PRINCIPAL_LABEL } from "@haibun/core/lib/resources.js";
import { readAction } from "@haibun/core/lib/actions.js";
import { getAvailableSteps } from "../rpc-registry.js";
import { queryGraph } from "../quads-snapshot.js";
import { pageAuthorityReady, pageHolds, pageMay } from "../page-key.js";

/** A principal as a view reads one: its own id, and the key it signs with where it declares one. */
export type TPrincipalRow = { id: string; publicKey?: string };

/** A record a view opens: the type the deployment records it as, and its id. */
export type TRecordRef = { persistedAs: string; id: string };

/** What holds here: the key this page signs as, what it may do, the delegation that granted each action it was
 *  delegated, and who the deployment knows. */
export type TAuthority = { controller?: string; holds: string[]; grantedBy: Record<string, TRecordRef>; principals: TPrincipalRow[] };

/**
 * AuthorityController: the per-view handle to what authority stands here. A view that shows permissions HOLDS one and
 * calls `read()`; it never assembles the RPC itself.
 *
 * What this page holds is read once, when the page boots, from what was delegated to its key, so a reader is told what
 * they may do even where nothing may be read. The principals are read only by a page that may read.
 */
export class AuthorityController implements ReactiveController {
	constructor(host: ReactiveControllerHost) {
		host.addController(this);
	}

	hostConnected(): void {} // read on demand, so a view that never opens its permissions asks nothing

	async read(): Promise<TAuthority> {
		await getAvailableSteps();
		const authority = await pageAuthorityReady();
		// Each action leads to the first delegation that lists it whose record this page may read, so no action offers a
		// way to a record the page would be refused.
		const grantedBy: Record<string, TRecordRef> = {};
		for (const delegation of authority?.delegations ?? []) {
			const record = typeof delegation.id === "string" ? authority?.records?.[delegation.id] : undefined;
			if (!record || !pageMay(readAction(record.accessLevel)) || !Array.isArray(delegation.allowedAction)) continue;
			for (const action of delegation.allowedAction) if (typeof action === "string") grantedBy[action] ??= { persistedAs: record.persistedAs, id: String(delegation.id) };
		}
		const principals = pageMay(readAction(Access.public)) ? ((await queryGraph({ label: PRINCIPAL_LABEL })).vertices ?? []) : [];
		return { controller: authority?.controller, holds: pageHolds(authority), grantedBy, principals: principals as TPrincipalRow[] };
	}
}
