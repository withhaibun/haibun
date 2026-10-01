/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Derived from Playwright 7b4b3b0828, packages/extension/src/relayConnection.ts. Changed: formatted to haibun's style;
 * the connection talks through a `TRelayChannel` (the `relay.attach` and `relay.send` calls) where upstream takes a
 * WebSocket; the chrome.* API is the one it is given, where upstream reads the global; it attaches the debugger only to
 * a tab the person chose and the tabs opened from those, where upstream attaches any tab the relay names; its close states
 * why it closed; `debugLog` is the log it is given; `any` is typed as `unknown` or the shape read.
 */

import { EXTENSION_COMMAND, type TBrowserTabText, type TRelayMessage } from "../relay/relay-wire.js";
import type { Debuggee, DebuggerSession, Tab } from "../relay/protocol.js";

/** A channel to the relay: messages out, messages in, and its end, with why it ended. */
export type TRelayChannel = {
	readonly open: boolean;
	send(message: TRelayMessage): void;
	close(reason: string): void;
	onmessage?: (message: TRelayMessage) => void;
	onclose?: (reason: string) => void;
};

type TChromeEvent<A extends unknown[]> = { addListener(listener: (...args: A) => void): void; removeListener(listener: (...args: A) => void): void };

/** The chrome.* API the connection uses: what a browser extension's `chrome` has, and what a test stands in for. */
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
	scripting: {
		executeScript<R>(injection: { target: { tabId: number }; func: () => R }): Promise<Array<{ result?: R }>>;
	};
};

type ProtocolCommand = {
	id: number;
	method: string;
	params?: unknown;
};

// Allow-listed chrome.* commands the relay may invoke. They are resolved
// reflectively and the positional params are spread into the call.
const ALLOWED_CHROME_COMMANDS = new Set([
	"chrome.debugger.attach",
	"chrome.debugger.detach",
	"chrome.debugger.sendCommand",
	"chrome.tabs.create",
	"chrome.tabs.remove",
	"chrome.tabs.query",
]);

/** What a tab's page shows, read in the tab: its title, its address and its text. */
const readThePage = () => ({ title: document.title, url: location.href, text: document.body?.innerText ?? "" });

// chrome.* events the extension forwards to the relay (positional params).
const CHROME_EVENT_METHODS = ["chrome.debugger.onEvent", "chrome.debugger.onDetach", "chrome.tabs.onCreated", "chrome.tabs.onRemoved"];

const REATTACH_DELAY_MS = 150;
const REATTACH_VERIFY_MS = 2500;
const REATTACH_COOLDOWN_MS = 3000;

export class RelayConnection {
	private _channel: TRelayChannel;
	private _chrome: TChromeApi;
	private _log: (...args: unknown[]) => void;
	// Tabs whose debugger we have explicitly attached for this connection.
	private _attachedTabs = new Set<number>();
	// The tabs the relay may attach: those the person chose, the tabs opened from an attached one, and the tabs the relay
	// created.
	private _permittedTabs = new Set<number>();
	// Once we've attached at least one tab, detaching the last one closes the connection.
	private _hasEverAttached = false;
	private _eventListeners: Array<{ remove: () => void }> = [];
	private _closed = false;
	private _pendingReattach = new Set<number>();
	private _recentReattach = new Set<number>();

	onclose?: (reason: string) => void;
	ontabattached?: (tabId: number) => void;
	ontabdetached?: (tabId: number) => void;

	get attachedTabs(): ReadonlySet<number> {
		return this._attachedTabs;
	}

	constructor(channel: TRelayChannel, chrome: TChromeApi, log: (...args: unknown[]) => void) {
		this._channel = channel;
		this._chrome = chrome;
		this._log = log;
		this._installEventForwarders();
		this._channel.onmessage = (message) => this._onMessage(message);
		this._channel.onclose = (reason) => this._onClose(reason);
	}

	// Signals the end of the initial-tab handshake — call after the initial
	// round of `attachTab` invocations. The relay holds CDP traffic from
	// Playwright until it sees this event, so that `Target.setAutoAttach` is
	// answered from a populated tab model.
	didInitialize(): void {
		this._sendMessage({ method: "extension.initialized", params: [] });
	}

	close(message: string): void {
		this._channel.close(message);
		// The channel's close is reported asynchronously, so we call it here to avoid forwarding
		// CDP events to the closed connection.
		this._onClose(message);
	}

	// Called when the person chooses a tab to hand to the relay. Simulates a
	// "new tab opened" event; the relay responds by calling
	// chrome.debugger.attach, which flows through _handleCommand and fires
	// ontabattached.
	attachTab(tab: Tab): void {
		if (tab.id === undefined || this._closed || this._attachedTabs.has(tab.id)) return;
		this._permittedTabs.add(tab.id);
		this._sendMessage({ method: "chrome.tabs.onCreated", params: [tab] });
	}

	// Called when the person takes a tab back. We detach the debugger and
	// update bookkeeping. chrome.debugger.detach does not fire onDetach for the
	// caller, so we synthesize one so the relay notices the tab is gone.
	detachTab(tabId: number): void {
		if (this._closed || !this._attachedTabs.has(tabId)) return;
		this._permittedTabs.delete(tabId);
		this._chrome.debugger.detach({ tabId }).catch((error) => {
			this._log("Error detaching tab:", error);
		});
		this._notifyTabDetached(tabId);
		this._sendMessage({
			method: "chrome.debugger.onDetach",
			params: [{ tabId }, "target_closed"],
		});
		this._checkLastTabDetached();
	}

	private _notifyTabAttached(tabId: number): void {
		this._attachedTabs.add(tabId);
		this._hasEverAttached = true;
		this._pendingReattach.delete(tabId);
		this.ontabattached?.(tabId);
	}

	private _notifyTabDetached(tabId: number): void {
		this._attachedTabs.delete(tabId);
		this.ontabdetached?.(tabId);
	}

	private _installEventForwarders(): void {
		for (const fullMethod of CHROME_EVENT_METHODS) {
			const target = resolveChromeMember(this._chrome, fullMethod);
			const event = Reflect.get(target.obj, target.name) as TChromeEvent<unknown[]>;
			const listener = (...args: unknown[]) => this._onChromeEvent(fullMethod, args);
			event.addListener(listener);
			this._eventListeners.push({
				remove: () => event.removeListener(listener),
			});
		}
	}

	private _onClose(reason: string) {
		if (this._closed) return;
		this._closed = true;
		this._pendingReattach.clear();
		this._recentReattach.clear();
		for (const l of this._eventListeners) l.remove();
		this._eventListeners = [];
		for (const tabId of [...this._attachedTabs]) {
			this._chrome.debugger.detach({ tabId }).catch((error: unknown) => this._log("Error detaching tab:", error));
			this._notifyTabDetached(tabId);
		}
		this.onclose?.(reason);
	}

	private _checkLastTabDetached(): void {
		if (this._hasEverAttached && this._attachedTabs.size === 0 && this._pendingReattach.size === 0) this.close("All controlled tabs detached");
	}

	// Forwards chrome.* events concerning attached tabs to the relay, then runs
	// shared detach bookkeeping.
	private _onChromeEvent(fullMethod: string, args: unknown[]): void {
		const tabId = this._tabIdForEventArgs(fullMethod, args);
		// The debugger's events come from a tab it is attached to; a tab's own events come from any tab the relay may use,
		// since the relay attaches the debugger only while actuality's steps act in it.
		const followed = fullMethod.startsWith("chrome.debugger.") ? this._attachedTabs : this._permittedTabs;
		if (tabId === undefined || !followed.has(tabId)) return;
		// A tab opened from an attached tab is one the relay may attach.
		if (fullMethod === "chrome.tabs.onCreated") {
			const opened = (args[0] as Tab).id;
			if (opened !== undefined) this._permittedTabs.add(opened);
		}
		this._sendMessage({ method: fullMethod, params: args });
		// The attachment ends with the last tab the relay may use.
		if (fullMethod === "chrome.tabs.onRemoved") {
			this._permittedTabs.delete(tabId);
			if (this._permittedTabs.size === 0) this.close("The tabs the person attached were closed");
			return;
		}
		// chrome.debugger.onDetach is the single source of truth for detach bookkeeping.
		if (fullMethod === "chrome.debugger.onDetach") {
			const reason = args[1] as string | undefined;
			this._notifyTabDetached(tabId);
			if (reason === "target_closed" && this._maybeScheduleReattach(tabId)) return;
			this._checkLastTabDetached();
		}
	}

	private _maybeScheduleReattach(tabId: number): boolean {
		if (this._closed) return false;
		if (this._recentReattach.has(tabId)) {
			this._log(`Not re-attaching tab ${tabId}: re-detached within ${REATTACH_COOLDOWN_MS}ms`);
			return false;
		}
		this._recentReattach.add(tabId);
		setTimeout(() => this._recentReattach.delete(tabId), REATTACH_COOLDOWN_MS);
		this._pendingReattach.add(tabId);
		setTimeout(() => void this._tryReattach(tabId), REATTACH_DELAY_MS);
		return true;
	}

	private _reattachAborted(tabId: number): boolean {
		return this._closed || !this._pendingReattach.has(tabId);
	}

	private async _tryReattach(tabId: number): Promise<void> {
		if (this._reattachAborted(tabId)) return;
		let tab: Tab | undefined;
		try {
			tab = await this._chrome.tabs.get(tabId);
		} catch {
			this._pendingReattach.delete(tabId);
			this._checkLastTabDetached();
			return;
		}
		if (this._reattachAborted(tabId)) return;
		if (this._attachedTabs.has(tabId)) {
			this._pendingReattach.delete(tabId);
			return;
		}
		this.attachTab(tab);
		setTimeout(() => {
			if (this._reattachAborted(tabId)) return;
			this._pendingReattach.delete(tabId);
			if (!this._attachedTabs.has(tabId)) this._checkLastTabDetached();
		}, REATTACH_VERIFY_MS);
	}

	// Returns the tabId an event refers to, for filtering by the tabs the extension follows.
	private _tabIdForEventArgs(fullMethod: string, args: unknown[]): number | undefined {
		switch (fullMethod) {
			case "chrome.debugger.onEvent":
			case "chrome.debugger.onDetach":
				return (args[0] as Debuggee | undefined)?.tabId;
			case "chrome.tabs.onCreated": {
				const tab = args[0] as Tab;
				// Forward only popups opened by an attached tab; report the opener so cdpRelay
				// can filter / decide. We use the openerTabId for the attached-tab check.
				return tab.openerTabId;
			}
			case "chrome.tabs.onRemoved":
				return args[0] as number;
		}
		return undefined;
	}

	private _onMessage(message: TRelayMessage): void {
		this._onMessageAsync(message).catch((e) => this._log("Error handling message:", e));
	}

	private async _onMessageAsync(message: TRelayMessage): Promise<void> {
		const response: TRelayMessage = {
			id: message.id,
		};
		try {
			response.result = await this._handleCommand(message as ProtocolCommand);
		} catch (error) {
			this._log(`Error handling command ${JSON.stringify(message)}:`, error);
			response.error = (error as Error).message;
		}
		this._sendMessage(response);
	}

	private async _handleCommand(message: ProtocolCommand): Promise<unknown> {
		const args = (message.params ?? []) as unknown[];
		if (message.method === EXTENSION_COMMAND.readTab) return await this._readTab(Number(args[0]));
		if (!ALLOWED_CHROME_COMMANDS.has(message.method)) throw new Error(`Unknown method: ${message.method}`);
		this._checkPermitted(message.method, args);
		const result = await invokeChromeMethod(this._chrome, message.method, args);
		// Attach bookkeeping. The relay detaches a tab when the steps acting in it end, and the tab stays the person's to
		// attach again, so the attachment holds; Chrome's own detach flows through the chrome.debugger.onDetach event.
		const target = args[0] as Debuggee | undefined;
		if (message.method === "chrome.debugger.attach" && target?.tabId !== undefined) this._notifyTabAttached(target.tabId);
		if (message.method === "chrome.debugger.detach" && target?.tabId !== undefined) this._notifyTabDetached(target.tabId);
		// A tab the relay created is one it may attach.
		if (message.method === "chrome.tabs.create") {
			const created = (result as Tab | undefined)?.id;
			if (created !== undefined) this._permittedTabs.add(created);
		}
		return result ?? {};
	}

	/** A tab's text, read by a function the extension runs in the tab, without the debugger. */
	private async _readTab(tabId: number): Promise<TBrowserTabText> {
		const [injected] = await this._chrome.scripting.executeScript({ target: { tabId }, func: readThePage });
		if (!injected?.result) throw new Error(`${EXTENSION_COMMAND.readTab}: tab ${tabId} didn't return its page`);
		return { id: tabId, ...injected.result };
	}

	/** The debugger attaches only to a tab the relay may use: one the person chose, one opened from it, or one the relay
	 *  created. Listing, opening and closing a tab reach any tab: the instance's action for each decides whether a step may. */
	private _checkPermitted(method: string, args: unknown[]): void {
		if (!method.startsWith("chrome.debugger.")) return;
		const tabId = (args[0] as Debuggee | undefined)?.tabId;
		if (typeof tabId !== "number" || !this._permittedTabs.has(tabId))
			throw new Error(`${method}: tab ${String(tabId)} is not a tab the person attached, one opened from an attached tab, or one the relay created`);
	}

	private _sendMessage(message: TRelayMessage): void {
		if (this._channel.open) this._channel.send(message);
	}
}

// ─── Reflective chrome.* invocation ────────────────────────────────────────

// Resolves chrome.<api>.<member>, shared by command invocation and event
// listener installation.
function resolveChromeMember(chrome: TChromeApi, fullMethod: string): { obj: object; name: string } {
	const [root, ...path] = fullMethod.split(".");
	const name = path.pop();
	if (root !== "chrome" || name === undefined || path.length < 1) throw new Error(`Invalid chrome method: ${fullMethod}`);
	let obj: object = chrome;
	for (const [i, part] of path.entries()) {
		const member: unknown = Reflect.get(obj, part);
		if (typeof member !== "object" || member === null) throw new Error(`Unknown chrome path: ${[root, ...path.slice(0, i + 1)].join(".")}, calling ${fullMethod}`);
		obj = member;
	}
	return { obj, name };
}

async function invokeChromeMethod(chrome: TChromeApi, fullMethod: string, args: unknown[]): Promise<unknown> {
	const { obj, name } = resolveChromeMember(chrome, fullMethod);
	const fn: unknown = Reflect.get(obj, name);
	if (typeof fn !== "function") throw new Error(`Not a function: ${fullMethod}`);
	return await (fn as (...a: unknown[]) => Promise<unknown>).apply(obj, args);
}
