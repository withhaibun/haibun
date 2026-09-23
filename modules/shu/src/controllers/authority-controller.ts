import type { ReactiveController, ReactiveControllerHost } from "lit";
import { PRINCIPAL_LABEL } from "@haibun/core/lib/resources.js";
import { getAvailableSteps } from "../rpc-registry.js";
import { queryGraph } from "../quads-snapshot.js";
import { session } from "../session-key.js";

/** A principal as a view reads one: its own id, and the key it signs with where it declares one. */
export type TPrincipalRow = { id: string; publicKey?: string };

/** What holds here: what this reader may do, where what it holds is recorded, and who the deployment knows. */
export type TAuthority = { holds: string[]; heldAs?: { persistedAs: string; id: string }; principals: TPrincipalRow[] };

/**
 * AuthorityController: the per-view handle to what authority stands here. A view that shows permissions HOLDS one and
 * calls `read()`; it never assembles the RPC itself.
 *
 * What this reader holds is not asked for over the wire at all: it is in the session the page opened with its own key,
 * so a reader is told what they may do even when nothing may be read.
 */
export class AuthorityController implements ReactiveController {
	constructor(host: ReactiveControllerHost) {
		host.addController(this);
	}

	hostConnected(): void {} // read on demand, so a view that never opens its permissions asks nothing

	async read(): Promise<TAuthority> {
		await getAvailableSteps();
		const held = session();
		const holds = held?.allowedAction ?? [];
		const principals = await queryGraph({ label: PRINCIPAL_LABEL });
		return { holds, heldAs: held?.record, principals: (principals.vertices ?? []) as TPrincipalRow[] };
	}
}
