/**
 * The chrome.* API an extension gives the relay client, over a real Chromium's DevTools Protocol, so the client runs in
 * Node against a browser as it runs in an extension: `debugger` attaches to a tab's target and carries its commands and
 * events, and `tabs` creates, removes and reports the browser's page targets as tabs. The one fake of the extension's
 * side of the relay.
 */
import { chromium, type Browser } from "playwright";
import { freePort } from "@haibun/core/lib/test/lib.js";
import type { Debuggee, DebuggerSession, Tab } from "../relay/protocol.js";
import type { TChromeApi } from "./relayConnection.js";

type TListener<A extends unknown[]> = (...args: A) => void;

/** A chrome.* event: listeners added and removed, and fired by the fake. */
class ChromeEvent<A extends unknown[]> {
	private listeners = new Set<TListener<A>>();
	addListener(listener: TListener<A>): void {
		this.listeners.add(listener);
	}
	removeListener(listener: TListener<A>): void {
		this.listeners.delete(listener);
	}
	fire(...args: A): void {
		for (const listener of this.listeners) listener(...args);
	}
}

type TCdpMessage = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string }; sessionId?: string };
type TTargetInfo = { targetId: string; type: string; url: string; title: string; openerId?: string };

export class ChromeOverCdp implements TChromeApi {
	private nextId = 1;
	private nextTabId = 1;
	private pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
	private pages = new Map<number, TTargetInfo>();
	private tabOfTarget = new Map<string, number>();
	private sessionOfTab = new Map<number, string>();
	/** Each CDP session the fake knows, and the tab it belongs to: the tab's own session, or a child of it. */
	private tabOfSession = new Map<string, { tabId: number; child: boolean }>();
	private discovering = true;

	readonly debugger: TChromeApi["debugger"];
	readonly tabs: TChromeApi["tabs"];

	private constructor(
		private readonly socket: WebSocket,
		private readonly browser: Browser,
	) {
		const onEvent = new ChromeEvent<[source: DebuggerSession, method: string, params?: object]>();
		const onDetach = new ChromeEvent<[source: Debuggee, reason: string]>();
		const onCreated = new ChromeEvent<[tab: Tab]>();
		const onRemoved = new ChromeEvent<[tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }]>();
		this.events = { onEvent, onDetach, onCreated, onRemoved };
		this.debugger = {
			attach: async ({ tabId }) => {
				const { sessionId } = (await this.cdp("Target.attachToTarget", { targetId: this.target(tabId).targetId, flatten: true })) as { sessionId: string };
				this.sessionOfTab.set(this.known(tabId), sessionId);
				this.tabOfSession.set(sessionId, { tabId: this.known(tabId), child: false });
			},
			detach: async ({ tabId }) => {
				const sessionId = this.sessionOfTab.get(this.known(tabId));
				if (!sessionId) throw new Error(`Debugger is not attached to the tab with id: ${tabId}.`);
				// Chrome doesn't fire onDetach for a detach the extension asked for, so the session is forgotten before it ends.
				this.sessionOfTab.delete(this.known(tabId));
				this.tabOfSession.delete(sessionId);
				await this.cdp("Target.detachFromTarget", { sessionId });
			},
			sendCommand: async ({ tabId, sessionId }, method, commandParams) => {
				const session = sessionId ?? this.sessionOfTab.get(this.known(tabId));
				if (!session) throw new Error(`Debugger is not attached to the tab with id: ${tabId}.`);
				return await this.cdp(method, commandParams as Record<string, unknown> | undefined, session);
			},
			onEvent,
			onDetach,
		};
		this.tabs = {
			create: async ({ url }) => {
				const { targetId } = (await this.cdp("Target.createTarget", { url: url ?? "about:blank" })) as { targetId: string };
				return this.tab(this.tabOfTarget.get(targetId) ?? this.remember({ targetId, type: "page", url: url ?? "about:blank", title: "" }));
			},
			remove: async (tabIds) => {
				for (const tabId of [tabIds].flat()) await this.cdp("Target.closeTarget", { targetId: this.target(tabId).targetId });
			},
			get: (tabId) => Promise.resolve(this.tab(this.known(tabId))),
			onCreated,
			onRemoved,
		};
		socket.addEventListener("message", (event) => this.receive(JSON.parse(String(event.data)) as TCdpMessage));
	}

	private readonly events: {
		onEvent: ChromeEvent<[source: DebuggerSession, method: string, params?: object]>;
		onDetach: ChromeEvent<[source: Debuggee, reason: string]>;
		onCreated: ChromeEvent<[tab: Tab]>;
		onRemoved: ChromeEvent<[tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }]>;
	};

	/** Launch a Chromium with its DevTools Protocol reachable, and read its targets: one page, the tab a person has open. */
	static async launch(): Promise<ChromeOverCdp> {
		const port = await freePort();
		const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${port}`] });
		const { webSocketDebuggerUrl } = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
		const socket = new WebSocket(webSocketDebuggerUrl);
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => resolve(), { once: true });
			socket.addEventListener("error", () => reject(new Error(`no DevTools Protocol at ${webSocketDebuggerUrl}`)), { once: true });
		});
		const chrome = new ChromeOverCdp(socket, browser);
		await chrome.cdp("Target.setDiscoverTargets", { discover: true });
		if (!chrome.pages.size) await chrome.cdp("Target.createTarget", { url: "about:blank" });
		chrome.discovering = false;
		return chrome;
	}

	/** The tab a person has open, which they hand to the relay. */
	firstTab(): Tab {
		const [tabId] = this.pages.keys();
		if (tabId === undefined) throw new Error("the browser has no tab open");
		return this.tab(tabId);
	}

	async close(): Promise<void> {
		this.socket.close();
		await this.browser.close();
	}

	private cdp(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown> {
		const id = this.nextId++;
		this.socket.send(JSON.stringify({ id, method, params: params ?? {}, ...(sessionId ? { sessionId } : {}) }));
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
	}

	private receive(message: TCdpMessage): void {
		if (message.id !== undefined) {
			const pending = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (message.error) pending?.reject(new Error(message.error.message));
			else pending?.resolve(message.result);
			return;
		}
		const params = message.params ?? {};
		if (!message.sessionId) return this.browserEvent(message.method ?? "", params);
		const owner = this.tabOfSession.get(message.sessionId);
		if (!owner) return;
		// A child session a tab's own session attached belongs to the tab, and its events carry their session.
		const child = (params as { sessionId?: string }).sessionId;
		if (message.method === "Target.attachedToTarget" && child) this.tabOfSession.set(child, { tabId: owner.tabId, child: true });
		this.events.onEvent.fire(owner.child ? { tabId: owner.tabId, sessionId: message.sessionId } : { tabId: owner.tabId }, message.method ?? "", params);
	}

	private browserEvent(method: string, params: Record<string, unknown>): void {
		const info = params.targetInfo as TTargetInfo | undefined;
		if (method === "Target.targetCreated" && info?.type === "page") {
			const tabId = this.remember(info);
			if (!this.discovering) this.events.onCreated.fire(this.tab(tabId));
		} else if (method === "Target.targetInfoChanged" && info && this.tabOfTarget.has(info.targetId)) {
			this.pages.set(this.known(this.tabOfTarget.get(info.targetId)), info);
		} else if (method === "Target.targetDestroyed") {
			const tabId = this.tabOfTarget.get(String(params.targetId));
			if (tabId === undefined) return;
			this.pages.delete(tabId);
			this.events.onRemoved.fire(tabId, { windowId: 1, isWindowClosing: false });
		} else if (method === "Target.detachedFromTarget") {
			const owner = this.tabOfSession.get(String(params.sessionId));
			if (!owner || owner.child) return;
			this.tabOfSession.delete(String(params.sessionId));
			if (this.sessionOfTab.get(owner.tabId) === params.sessionId) this.sessionOfTab.delete(owner.tabId);
			this.events.onDetach.fire({ tabId: owner.tabId }, "target_closed");
		}
	}

	private remember(info: TTargetInfo): number {
		const held = this.tabOfTarget.get(info.targetId);
		if (held !== undefined) return held;
		const tabId = this.nextTabId++;
		this.pages.set(tabId, info);
		this.tabOfTarget.set(info.targetId, tabId);
		return tabId;
	}

	private known(tabId: number | undefined): number {
		if (tabId === undefined || !this.pages.has(tabId)) throw new Error(`No tab with id: ${tabId}.`);
		return tabId;
	}

	private target(tabId: number | undefined): TTargetInfo {
		return this.pages.get(this.known(tabId)) as TTargetInfo;
	}

	private tab(tabId: number): Tab {
		const info = this.target(tabId);
		const opener = info.openerId === undefined ? undefined : this.tabOfTarget.get(info.openerId);
		return { id: tabId, index: tabId - 1, windowId: 1, active: true, pinned: false, url: info.url, title: info.title, ...(opener === undefined ? {} : { openerTabId: opener }) };
	}
}
