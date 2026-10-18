import type { ReactiveController, ReactiveControllerHost } from "lit";
import { Access, principalRow, principalsQuery, type TPrincipalRow } from "@haibun/core/lib/domains/resources.js";
import { delegatedActions, readAction, recordReadAction } from "@haibun/core/lib/domains/actions.js";
import { getAvailableSteps } from "./registry-controller.js";
import { pageAuthorityPort } from "../root.js";
import { queryGraph } from "./read-controller.js";
import { outcomeOf, type TCallOutcome } from "../pipelines/call-step.js";

/** Whether the page holds what `action` requires. */
export const pageMay = (action: string): boolean => pageAuthorityPort().may(action);

/** Returns each action the page holds. */
export const pageHolds = (): string[] => pageAuthorityPort().holds();

const pageAuthorityReady = () => pageAuthorityPort().ready();

export type { TPrincipalRow };

/** A record a view opens: the type the deployment records it as, and its id. */
type TRecordRef = { persistedAs: string; id: string };

/** What holds here: the key this page signs as, what it may do, the delegation that granted each action it was
 *  delegated, and who the deployment knows. */
export type TAuthority = { controller?: string; holds: string[]; grantedBy: Record<string, TRecordRef>; principals: TPrincipalRow[] };

/**
 * AuthorityController: the per-view handle to what authority stands here. A view that shows permissions HOLDS one and
 * calls `read()`; it never assembles the RPC itself.
 *
 * What this page holds is read once, when the page boots, from what was delegated to its key, so a reader is told what
 * they may do even where the page may not read. The principals are read only by a page that may read.
 */
export class AuthorityController implements ReactiveController {
	constructor(host: ReactiveControllerHost) {
		host.addController(this);
	}

	hostConnected(): void {} // read on demand, so a view that never opens its permissions doesn't ask

	async read(): Promise<TAuthority> {
		await getAvailableSteps();
		const authority = await pageAuthorityReady();
		// Each action leads to the first delegation that lists it whose record this page may read, so an action doesn't offer a
		// way to a record the page would be refused.
		const grantedBy: Record<string, TRecordRef> = {};
		for (const delegation of authority?.delegations ?? []) {
			const record = typeof delegation.id === "string" ? authority?.records?.[delegation.id] : undefined;
			if (!record || !pageMay(recordReadAction(record))) continue;
			for (const action of delegatedActions(delegation)) grantedBy[action] ??= { persistedAs: record.persistedAs, id: String(delegation.id) };
		}
		const principals = pageMay(readAction(Access.public)) ? (await queryGraph(principalsQuery())).vertices.map(principalRow) : [];
		return { controller: authority?.controller, holds: pageHolds(), grantedBy, principals };
	}

	/** Returns what holds here, or the refusal of its read. */
	readOutcome(): Promise<TCallOutcome<TAuthority>> {
		return outcomeOf(() => this.read());
	}
}
