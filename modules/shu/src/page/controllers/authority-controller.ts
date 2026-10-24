import type { TAction } from "@haibun/core/lib/domains/actions.js";
import type { TIndividualAddress } from "@haibun/core/lib/domains/typed-links.js";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { Access, principalRow, principalsQuery, type TPrincipalRow } from "@haibun/core/lib/domains/resources.js";
import { capabilityAllows, delegatedActions, readAction, recordReadAction } from "@haibun/core/lib/domains/actions.js";
import { getAvailableSteps } from "./registry-controller.js";
import { pageAuthorityPort } from "../root.js";
import { queryGraph } from "./read-controller.js";
import { outcomeOf, type TCallOutcome } from "../pipelines/call-step.js";
import type { TPageAuthority } from "../authority/pipelines/page-authority.js";

/** Whether the page holds what `action` requires. */
export const pageMay = (action: string): boolean => pageAuthorityPort().may(action);

/** Returns each action the page holds. */
export const pageHolds = (): TAction[] => pageAuthorityPort().holds();

const pageAuthorityReady = () => pageAuthorityPort().ready();

export type { TPrincipalRow };

/** What holds here: the key this page signs as, what it may do, the delegation that granted each action it was
 *  delegated, and the principals the deployment holds. */
export type TAuthority = { controller?: string; holds: TAction[]; grantedBy: Record<string, TIndividualAddress>; principals: TPrincipalRow[] };

/** The delegations of each authority the page held, derived once for each, since each action a view shows reads them. */
const heldDelegations = new WeakMap<TPageAuthority, Record<string, TIndividualAddress>>();

/** The delegation of each action the page was delegated, by the action it lists: the first delegation that lists
 *  it whose record this page may read, so an action doesn't offer a way to a record the page would be refused. */
function delegationsOf(authority: TPageAuthority | undefined): Record<string, TIndividualAddress> {
	if (authority === undefined) return {};
	const held = heldDelegations.get(authority);
	if (held !== undefined) return held;
	const delegated: Record<string, TIndividualAddress> = {};
	for (const delegation of authority.delegations) {
		const record = typeof delegation.id === "string" ? authority.records?.[delegation.id] : undefined;
		if (!record || !pageMay(recordReadAction(record))) continue;
		for (const action of delegatedActions(delegation)) delegated[action] ??= { persistedAs: record.persistedAs, id: String(delegation.id) };
	}
	heldDelegations.set(authority, delegated);
	return delegated;
}

/** Whether the page's key holds an action, and the delegation of the action to it, where it holds the action through a
 *  delegation whose record it may read. */
export type THolder = { holds: boolean; delegation?: TIndividualAddress };

/** Who holds `action` here: whether this page's key does, and the delegation of the action to it. */
export async function holderOf(action: TAction): Promise<THolder> {
	const delegation = Object.entries(delegationsOf(await pageAuthorityReady())).find(([listed]) => capabilityAllows(listed, action))?.[1];
	return { holds: pageMay(action), ...(delegation === undefined ? {} : { delegation }) };
}

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

	hostConnected(): void {} // read on demand, so a view that never opens its permissions doesn't read it

	async read(): Promise<TAuthority> {
		await getAvailableSteps();
		const authority = await pageAuthorityReady();
		const principals = pageMay(readAction(Access.public)) ? (await queryGraph(principalsQuery())).vertices.map(principalRow) : [];
		return { controller: authority?.controller, holds: pageHolds(), grantedBy: delegationsOf(authority), principals };
	}

	/** Returns what holds here, or the refusal of its read. */
	readOutcome(): Promise<TCallOutcome<TAuthority>> {
		return outcomeOf(() => this.read());
	}
}
