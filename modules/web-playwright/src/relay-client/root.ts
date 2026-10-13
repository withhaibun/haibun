/**
 * The composition root of the extension's side of the relay: a connection over the channel and the chrome.* API the
 * extension gives it, with the system clock and the relay connection machine for its tabs.
 */
import { machine } from "@haibun/core/lib/machine.js";
import { ChromeRelayConnection } from "./adapters/relay-connection.js";
import { timerClock } from "./adapters/clock.js";
import { CLOSE, debugged, INITIAL_RELAY_CONNECTION, RELAY_TAB_EVENT, relayConnectionTransition, TAB_STATUS, tabStatusOf, usable } from "./machines/relay-connection.js";
import type { TChromeApi, TRelayChannel, TRelayTabs } from "./ports.js";

/** The connection's tabs over one relay connection machine. */
function relayTabs(): TRelayTabs {
	const connection = machine(INITIAL_RELAY_CONNECTION, relayConnectionTransition);
	const statusOf = (tabId: number) => tabStatusOf(connection.state.get(), tabId);
	const moves = (type: (typeof RELAY_TAB_EVENT)[keyof typeof RELAY_TAB_EVENT]) => (tabId: number) => void connection.dispatch({ type, tabId });
	return {
		permitted: moves(RELAY_TAB_EVENT.PERMITTED),
		attached: moves(RELAY_TAB_EVENT.ATTACHED),
		released: moves(RELAY_TAB_EVENT.RELEASED),
		detached: moves(RELAY_TAB_EVENT.DETACHED),
		lost: moves(RELAY_TAB_EVENT.LOST),
		reattachEnded: moves(RELAY_TAB_EVENT.REATTACH_ENDED),
		cooled: moves(RELAY_TAB_EVENT.COOLED),
		removed: moves(RELAY_TAB_EVENT.REMOVED),
		close: (reason) => void connection.dispatch({ type: CLOSE, reason }),
		usable: (tabId) => usable(statusOf(tabId)),
		debugged: (tabId) => debugged(statusOf(tabId)),
		isAttached: (tabId) => statusOf(tabId) === TAB_STATUS.ATTACHED,
		reattaching: (tabId) => statusOf(tabId) === TAB_STATUS.REATTACHING,
		debuggedTabs: () => [...connection.state.get().tabs].filter(([, status]) => debugged(status)).map(([tabId]) => tabId),
		closedBecause: () => connection.state.get().closedBecause,
	};
}

/** The extension's connection to the relay over `channel`, driving the browser through `chrome`, logging through `log`. */
export class RelayConnection extends ChromeRelayConnection {
	constructor(channel: TRelayChannel, chrome: TChromeApi, log: (...args: unknown[]) => void) {
		super(channel, chrome, log, { clock: timerClock, tabs: relayTabs() });
	}
}
