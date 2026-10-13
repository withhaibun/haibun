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
 * its comments rewritten; the connection talks through a `TRelayChannel` (the `relay.attach` and `relay.send` calls)
 * where upstream takes a WebSocket; the chrome.* API, the clock and the tabs' statuses are the ones it takes, where
 * upstream reads the global and holds sets of its own; it attaches the debugger only to a tab the person chose and the
 * tabs opened from those, where upstream attaches any tab the relay names; its close states its cause; `debugLog` is the
 * log it takes; `any` is typed as `unknown` or the shape read.
 */

import { EXTENSION_COMMAND, type TRelayMessage } from "../../adapters/relay-wire.js";
import type { Debuggee, Tab } from "../../ports.js";
import type { TClock, TChromeApi, TRelayChannel, TRelayTabs } from "../ports.js";

type TChromeEvent = { addListener(listener: (...args: unknown[]) => void): void; removeListener(listener: (...args: unknown[]) => void): void };
type ProtocolCommand = { id: number; method: string; params?: unknown };
type TBrowserTabText = { id: number; title: string; url: string; text: string };

/** Whether a chrome.* method is the debugger's, which reaches only a tab the relay may use. */
const isDebuggerMethod = (method: string): boolean => method.startsWith("chrome.debugger.");

/** The chrome.* commands the relay may call. Each is resolved by its name, and its positional parameters are spread into the call. */
const ALLOWED_CHROME_COMMANDS = new Set([
	"chrome.debugger.attach",
	"chrome.debugger.detach",
	"chrome.debugger.sendCommand",
	"chrome.tabs.create",
	"chrome.tabs.remove",
	"chrome.tabs.query",
]);

/** What a tab's page shows, read in the tab: its title, its address and its text. */
const readThePage = () => ({ title: document.title, url: location.href, text: document.body ? document.body.innerText : "" });

/** The chrome.* events the extension forwards to the relay, each with its positional parameters. */
const CHROME_EVENT_METHODS = ["chrome.debugger.onEvent", "chrome.debugger.onDetach", "chrome.tabs.onCreated", "chrome.tabs.onRemoved"];
/** The reason of a debugger's detachment as a tab's page goes, which the connection reattaches after. */
const TARGET_CLOSED = "target_closed";
const INITIALIZED = "extension.initialized";

const REATTACH_DELAY_MS = 150;
const REATTACH_VERIFY_MS = 2500;
const REATTACH_COOLDOWN_MS = 3000;

/** What a connection takes beside its channel, its chrome.* API and its log: the clock and its tabs' statuses. */
export type TRelayConnectionMakes = { clock: TClock; tabs: TRelayTabs };

export class ChromeRelayConnection {
	readonly #channel: TRelayChannel;
	readonly #chrome: TChromeApi;
	readonly #log: (...args: unknown[]) => void;
	readonly #clock: TClock;
	readonly #tabs: TRelayTabs;
	#removeListeners: Array<() => void> = [];
	#ended = false;

	onclose?: (reason: string) => void;

	constructor(channel: TRelayChannel, chrome: TChromeApi, log: (...args: unknown[]) => void, { clock, tabs }: TRelayConnectionMakes) {
		this.#channel = channel;
		this.#chrome = chrome;
		this.#log = log;
		this.#clock = clock;
		this.#tabs = tabs;
		this.#installEventForwarders();
		this.#channel.onmessage = (message) => this.#onMessage(message);
		this.#channel.onclose = (reason) => this.#end(reason);
	}

	/** Ends the first report of the person's tabs, after the first round of `attachTab`. The relay holds Playwright's CDP
	 *  until this event, so `Target.setAutoAttach` reads a full tab model. */
	didInitialize(): void {
		this.#sendMessage({ method: INITIALIZED, params: [] });
	}

	close(message: string): void {
		this.#channel.close(message);
		// The channel reports its close later, so the connection ends now, and doesn't forward CDP events to a closed channel.
		this.#end(message);
	}

	/** A tab the person chose for the relay, reported as a new tab: the relay attaches the debugger to it while its steps act in it. */
	attachTab(tab: Tab): void {
		if (tab.id === undefined || this.#ended || this.#tabs.isAttached(tab.id)) return;
		this.#tabs.permitted(tab.id);
		this.#sendMessage({ method: "chrome.tabs.onCreated", params: [tab] });
	}

	#installEventForwarders(): void {
		for (const fullMethod of CHROME_EVENT_METHODS) {
			const target = resolveChromeMember(this.#chrome, fullMethod);
			const event = Reflect.get(target.obj, target.name) as TChromeEvent;
			const listener = (...args: unknown[]) => this.#onChromeEvent(fullMethod, args);
			event.addListener(listener);
			this.#removeListeners.push(() => event.removeListener(listener));
		}
	}

	#end(reason: string): void {
		if (this.#ended) return;
		this.#ended = true;
		this.#tabs.close(reason);
		for (const remove of this.#removeListeners) remove();
		this.#removeListeners = [];
		for (const tabId of this.#tabs.debuggedTabs())
			this.#chrome.debugger.detach({ tabId }).catch((error: unknown) => this.#log(`detaching the debugger from tab ${tabId} failed:`, error));
		this.onclose?.(reason);
	}

	/** Closes the connection where the tabs' statuses closed it. */
	#closeWhereClosed(): void {
		const because = this.#tabs.closedBecause();
		if (because !== undefined) this.close(because);
	}

	/** Forwards a chrome.* event of a tab the relay follows, and moves the tab's status by it. */
	#onChromeEvent(fullMethod: string, args: unknown[]): void {
		const tabId = tabIdForEventArgs(fullMethod, args);
		// The debugger's events come from a tab it is on; a tab's own events come from any tab the relay may use, since the
		// relay attaches the debugger only while actuality's steps act in it.
		if (tabId === undefined || !(isDebuggerMethod(fullMethod) ? this.#tabs.debugged(tabId) : this.#tabs.usable(tabId))) return;
		if (fullMethod === "chrome.tabs.onCreated") {
			// A tab opened from a tab the relay may use is one it may use.
			const opened = (args[0] as Tab).id;
			if (opened !== undefined) this.#tabs.permitted(opened);
		}
		this.#sendMessage({ method: fullMethod, params: args });
		if (fullMethod === "chrome.tabs.onRemoved") {
			this.#tabs.removed(tabId);
			this.#closeWhereClosed();
		}
		if (fullMethod === "chrome.debugger.onDetach") this.#onDetach(tabId, args[1] as string | undefined);
	}

	/** The browser took the debugger off a tab: where its page went, the connection reattaches it, unless it went again within its cooldown. */
	#onDetach(tabId: number, reason: string | undefined): void {
		if (reason === TARGET_CLOSED) this.#tabs.lost(tabId);
		else this.#tabs.detached(tabId);
		if (this.#tabs.reattaching(tabId)) {
			this.#clock.after(REATTACH_COOLDOWN_MS, () => this.#tabs.cooled(tabId));
			this.#clock.after(REATTACH_DELAY_MS, () => void this.#tryReattach(tabId));
		} else if (reason === TARGET_CLOSED) this.#log(`tab ${tabId} isn't reattached: its debugger detached again within ${REATTACH_COOLDOWN_MS}ms`);
		this.#closeWhereClosed();
	}

	async #tryReattach(tabId: number): Promise<void> {
		if (this.#ended || !this.#tabs.reattaching(tabId)) return;
		const tab = await this.#chrome.tabs.get(tabId).catch(() => undefined);
		if (tab === undefined) {
			this.#tabs.reattachEnded(tabId);
			this.#closeWhereClosed();
			return;
		}
		if (this.#ended || !this.#tabs.reattaching(tabId)) return;
		this.attachTab(tab);
		this.#clock.after(REATTACH_VERIFY_MS, () => {
			if (this.#ended || !this.#tabs.reattaching(tabId)) return;
			this.#tabs.reattachEnded(tabId);
			this.#closeWhereClosed();
		});
	}

	#onMessage(message: TRelayMessage): void {
		this.#onMessageAsync(message).catch((e: unknown) => this.#log("handling a relay message failed:", e));
	}

	async #onMessageAsync(message: TRelayMessage): Promise<void> {
		const response: TRelayMessage = { id: message.id };
		try {
			response.result = await this.#handleCommand(message as ProtocolCommand);
		} catch (error) {
			this.#log(`the command ${JSON.stringify(message)} failed:`, error);
			response.error = error instanceof Error ? error.message : String(error);
		}
		this.#sendMessage(response);
	}

	async #handleCommand(message: ProtocolCommand): Promise<unknown> {
		const args = message.params === undefined ? [] : (message.params as unknown[]);
		if (message.method === EXTENSION_COMMAND.readTab) return await this.#readTab(Number(args[0]));
		if (!ALLOWED_CHROME_COMMANDS.has(message.method)) throw new Error(`the relay sent the command ${message.method}, which the extension doesn't carry out`);
		this.#checkPermitted(message.method, args);
		const result = await invokeChromeMethod(this.#chrome, message.method, args);
		// The relay takes the debugger off a tab when the steps acting in it end, and the tab stays the person's to attach
		// again, so the attachment holds; the browser's own detachment arrives as chrome.debugger.onDetach.
		const target = args[0] as Debuggee | undefined;
		if (message.method === "chrome.debugger.attach" && target?.tabId !== undefined) this.#tabs.attached(target.tabId);
		if (message.method === "chrome.debugger.detach" && target?.tabId !== undefined) this.#tabs.released(target.tabId);
		// A tab the relay created is one it may use.
		if (message.method === "chrome.tabs.create") {
			const created = (result as Tab | undefined)?.id;
			if (created !== undefined) this.#tabs.permitted(created);
		}
		return result === undefined ? {} : result;
	}

	/** A tab's text, read by a function the extension runs in the tab, without the debugger. */
	async #readTab(tabId: number): Promise<TBrowserTabText> {
		const [injected] = await this.#chrome.scripting.executeScript({ target: { tabId }, func: readThePage });
		if (!injected?.result) throw new Error(`${EXTENSION_COMMAND.readTab}: tab ${tabId} didn't return its page`);
		return { id: tabId, ...injected.result };
	}

	/** The debugger attaches only to a tab the relay may use: one the person chose, one opened from it, or one the relay
	 *  created. Listing, opening and closing a tab reach any tab: the instance's action for each holds a step to its delegation. */
	#checkPermitted(method: string, args: unknown[]): void {
		if (!isDebuggerMethod(method)) return;
		const tabId = (args[0] as Debuggee | undefined)?.tabId;
		if (typeof tabId !== "number" || !this.#tabs.usable(tabId))
			throw new Error(`${method}: tab ${String(tabId)} is not a tab the person attached, one opened from an attached tab, or one the relay created`);
	}

	#sendMessage(message: TRelayMessage): void {
		if (this.#channel.open) this.#channel.send(message);
	}
}

/** The tab an event concerns, by which the connection filters the tabs it follows: a new tab by its opener. */
function tabIdForEventArgs(fullMethod: string, args: unknown[]): number | undefined {
	switch (fullMethod) {
		case "chrome.debugger.onEvent":
		case "chrome.debugger.onDetach":
			return (args[0] as Debuggee | undefined)?.tabId;
		case "chrome.tabs.onCreated":
			return (args[0] as Tab).openerTabId;
		case "chrome.tabs.onRemoved":
			return args[0] as number;
	}
	return undefined;
}

/** Resolves chrome.<api>.<member>, for a command's call and an event's listener. */
function resolveChromeMember(chrome: TChromeApi, fullMethod: string): { obj: object; name: string } {
	const [root, ...path] = fullMethod.split(".");
	const name = path.pop();
	if (root !== "chrome" || name === undefined || path.length < 1) throw new Error(`${fullMethod} isn't a chrome.<api>.<member> method`);
	let obj: object = chrome;
	for (const [i, part] of path.entries()) {
		const member: unknown = Reflect.get(obj, part);
		if (typeof member !== "object" || member === null) throw new Error(`the chrome API lacks ${[root, ...path.slice(0, i + 1)].join(".")}, which ${fullMethod} calls`);
		obj = member;
	}
	return { obj, name };
}

async function invokeChromeMethod(chrome: TChromeApi, fullMethod: string, args: unknown[]): Promise<unknown> {
	const { obj, name } = resolveChromeMember(chrome, fullMethod);
	const fn: unknown = Reflect.get(obj, name);
	if (typeof fn !== "function") throw new Error(`the chrome API's ${fullMethod} isn't a function`);
	return await (fn as (...a: unknown[]) => Promise<unknown>).apply(obj, args);
}
