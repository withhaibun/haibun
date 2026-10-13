/**
 * The extension's connection to an instance's relay, by the tabs the relay may use. A tab is permitted once the person
 * chooses it, once it opens from a permitted tab, or once the relay creates it; attached while the debugger is on it;
 * reattaching after the browser takes the debugger off it as its page goes; and closing where the person closed it while
 * the debugger is still on it. A tab the browser detaches again within its cooldown isn't reattached. The connection
 * closes once the last attached tab detaches, after one was attached, or once the last permitted tab closes, or when
 * either side closes it.
 */

export const TAB_STATUS = { ABSENT: "absent", PERMITTED: "permitted", ATTACHED: "attached", REATTACHING: "reattaching", CLOSING: "closing" } as const;
export type TTabStatus = (typeof TAB_STATUS)[keyof typeof TAB_STATUS];

/**
 * What moves a tab: the relay may use it, the debugger attached to it, the relay took the debugger off it, the browser
 * detached the debugger, the browser detached it as its page went, a reattachment ended without the debugger, its
 * cooldown passed, and the person closed it.
 */
export const RELAY_TAB_EVENT = {
	PERMITTED: "permitted",
	ATTACHED: "attached",
	RELEASED: "released",
	DETACHED: "detached",
	LOST: "lost",
	REATTACH_ENDED: "reattach-ended",
	COOLED: "cooled",
	REMOVED: "removed",
} as const;
export const CLOSE = "close";
export type TRelayConnectionEvent = { type: (typeof RELAY_TAB_EVENT)[keyof typeof RELAY_TAB_EVENT]; tabId: number } | { type: typeof CLOSE; reason: string };

/** Why the connection closed on its own. */
export const CLOSED_BECAUSE = { allDetached: "All controlled tabs detached", tabsClosed: "The tabs the person attached were closed" } as const;

/** The connection: each tab the relay may use or still follows, the tabs whose cooldown runs, whether a tab was ever
 *  attached, and why it closed, once it closed. */
export type TRelayConnectionState = { tabs: ReadonlyMap<number, TTabStatus>; cooling: ReadonlySet<number>; everAttached: boolean; closedBecause?: string };

export const INITIAL_RELAY_CONNECTION: TRelayConnectionState = { tabs: new Map(), cooling: new Set(), everAttached: false };

/** A tab's status in a state. */
export function tabStatusOf({ tabs }: TRelayConnectionState, tabId: number): TTabStatus {
	const status = tabs.get(tabId);
	return status === undefined ? TAB_STATUS.ABSENT : status;
}

const { ABSENT, PERMITTED, ATTACHED, REATTACHING, CLOSING } = TAB_STATUS;
/** The statuses of a tab the relay may use: the debugger may attach to it, and its tab events are forwarded. */
const USABLE: readonly TTabStatus[] = [PERMITTED, ATTACHED, REATTACHING];

/** Whether the relay may use a tab: attach the debugger to it, and follow its tab events. */
export const usable = (status: TTabStatus): boolean => USABLE.includes(status);
/** Whether the debugger is on a tab, so its debugger events are forwarded. */
export const debugged = (status: TTabStatus): boolean => status === ATTACHED || status === CLOSING;

/** A tab's next status, from its status, an event, and whether its cooldown runs. */
function tabTransition(status: TTabStatus, type: (typeof RELAY_TAB_EVENT)[keyof typeof RELAY_TAB_EVENT], cooling: boolean): TTabStatus {
	switch (type) {
		case RELAY_TAB_EVENT.PERMITTED:
			return status === ABSENT ? PERMITTED : status;
		case RELAY_TAB_EVENT.ATTACHED:
			return status === PERMITTED || status === REATTACHING ? ATTACHED : status;
		case RELAY_TAB_EVENT.RELEASED:
		case RELAY_TAB_EVENT.DETACHED:
			if (status === CLOSING) return ABSENT;
			return status === ATTACHED || status === REATTACHING ? PERMITTED : status;
		case RELAY_TAB_EVENT.LOST:
			if (status === CLOSING) return ABSENT;
			if (status !== ATTACHED) return status;
			return cooling ? PERMITTED : REATTACHING;
		case RELAY_TAB_EVENT.REATTACH_ENDED:
			return status === REATTACHING ? PERMITTED : status;
		case RELAY_TAB_EVENT.REMOVED:
			return status === ATTACHED || status === CLOSING ? CLOSING : ABSENT;
		case RELAY_TAB_EVENT.COOLED:
			return status;
	}
}

/** The events after which the connection closes where a tab was attached and every tab is now detached. */
const ENDS_A_DEBUGGER = new Set<string>([RELAY_TAB_EVENT.DETACHED, RELAY_TAB_EVENT.LOST, RELAY_TAB_EVENT.REATTACH_ENDED]);

/** Returns the next state from `state` and `event`. A closed connection stays closed. */
export function relayConnectionTransition(state: TRelayConnectionState, event: TRelayConnectionEvent): TRelayConnectionState {
	if (state.closedBecause !== undefined) return state;
	if (event.type === CLOSE) return { ...state, closedBecause: event.reason };
	const { type, tabId } = event;
	const before = tabStatusOf(state, tabId);
	const after = tabTransition(before, type, state.cooling.has(tabId));
	const starts = after === REATTACHING && before !== REATTACHING;
	const cooled = type === RELAY_TAB_EVENT.COOLED && state.cooling.has(tabId);
	if (after === before && !starts && !cooled) return state;
	const tabs = new Map(state.tabs);
	if (after === ABSENT) tabs.delete(tabId);
	else tabs.set(tabId, after);
	const cooling = new Set(state.cooling);
	if (starts) cooling.add(tabId);
	if (cooled) cooling.delete(tabId);
	const next: TRelayConnectionState = { tabs, cooling, everAttached: state.everAttached || after === ATTACHED };
	if (after === before) return next;
	const statuses = [...tabs.values()];
	if (type === RELAY_TAB_EVENT.REMOVED && usable(before) && !statuses.some(usable)) return { ...next, closedBecause: CLOSED_BECAUSE.tabsClosed };
	if (ENDS_A_DEBUGGER.has(type) && next.everAttached && !statuses.some((status) => status === ATTACHED || status === REATTACHING))
		return { ...next, closedBecause: CLOSED_BECAUSE.allDetached };
	return next;
}
