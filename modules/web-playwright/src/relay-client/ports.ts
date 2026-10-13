/** The ports of the extension's side of the relay: its channel to the relay, the browser's chrome.* API, a clock, and the connection's tabs. */
import type { Debuggee, DebuggerSession, Tab } from "../ports.js";
import type { TRelayMessage } from "../adapters/relay-wire.js";

/** A channel to the relay: messages out, messages in, and its end, with the cause of its end. */
export type TRelayChannel = {
	readonly open: boolean;
	send(message: TRelayMessage): void;
	close(reason: string): void;
	onmessage?: (message: TRelayMessage) => void;
	onclose?: (reason: string) => void;
};

type TChromeEvent<A extends unknown[]> = { addListener(listener: (...args: A) => void): void; removeListener(listener: (...args: A) => void): void };

/** The chrome.* API the connection uses: a browser extension's `chrome`, or a test's stand-in for it. */
export type TChromeApi = {
	debugger: {
		attach(target: Debuggee, requiredVersion: string): Promise<void>;
		detach(target: Debuggee): Promise<void>;
		sendCommand(target: DebuggerSession, method: string, commandParams?: object): Promise<unknown>;
		onEvent: TChromeEvent<[source: DebuggerSession, method: string, params?: object]>;
		onDetach: TChromeEvent<[source: Debuggee, reason: string]>;
	};
	tabs: {
		create(createProperties: { url?: string }): Promise<Tab>;
		remove(tabIds: number | number[]): Promise<void>;
		get(tabId: number): Promise<Tab>;
		query(queryInfo: object): Promise<Tab[]>;
		onCreated: TChromeEvent<[tab: Tab]>;
		onRemoved: TChromeEvent<[tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }]>;
	};
	scripting: { executeScript<R>(injection: { target: { tabId: number }; func: () => R }): Promise<Array<{ result?: R }>> };
};

/** A clock that runs a task once a span passes. */
export type TClock = { after(ms: number, task: () => void): void };

/**
 * The connection's tabs, as the root builds them over the relay connection machine: each event that moves a tab, what a
 * tab's status allows, the tabs the debugger is on, and the cause of the connection's close, once it closed.
 */
export type TRelayTabs = {
	permitted(tabId: number): void;
	attached(tabId: number): void;
	released(tabId: number): void;
	detached(tabId: number): void;
	lost(tabId: number): void;
	reattachEnded(tabId: number): void;
	cooled(tabId: number): void;
	removed(tabId: number): void;
	close(reason: string): void;
	usable(tabId: number): boolean;
	debugged(tabId: number): boolean;
	isAttached(tabId: number): boolean;
	reattaching(tabId: number): boolean;
	debuggedTabs(): number[];
	closedBecause(): string | undefined;
};
