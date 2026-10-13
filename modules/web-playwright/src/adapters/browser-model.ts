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
 * Derived from Playwright 7b4b3b0828, packages/playwright-core/src/tools/mcp/browserModel.ts. Changed: formatted to
 * haibun's style; its comments rewritten; `any` typed as `unknown` or the shape read; an unhandled error reaches the
 * `onError` the model takes, in place of Playwright's `logUnhandledError`.
 */

/**
 * The relay's model of the attached browser's tabs: the map between chrome tab ids and CDP session ids, and the one place
 * that translates between the chrome.* calls of the extension and the CDP of Playwright.
 *
 * 1. The extension connects and, once the person allows it, reports a `chrome.tabs.onCreated` for each tab it starts
 *    with, then `extension.initialized`. The model holds these as reported tabs without attaching the debugger.
 * 2. The relay holds Playwright's CDP until `ready()` resolves.
 * 3. Playwright sends `Target.setAutoAttach`, and the model's `enableAutoAttach()` attaches every known tab and emits
 *    `Target.attachedToTarget` for each.
 * 4. A later tab, a debugger's detachment and a tab's removal reach the same inputs, which emit their CDP events.
 */

import type { DebuggerSession, Debuggee, Tab } from "../ports.js";
import type { TRelayAttachment } from "../domains/relay.js";

export type CDPMessage = { id?: number; sessionId?: string; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message: string } };

export type SendCommand = (method: string, params: unknown) => Promise<unknown>;
export type SendToCDPClient = (message: CDPMessage) => void;
type TTargetInfo = { targetId?: string } & Record<string, unknown>;

type TabSession = {
	tabId: number;
	sessionId: string;
	targetInfo: TTargetInfo | undefined;
	/** The tab's child CDP sessions (workers, out-of-process frames), as `Target.attachedToTarget` and `Target.detachedFromTarget` state them. */
	childSessions: Set<string>;
};

/** The CDP version of the debugger's attachment. */
const DEBUGGER_VERSION = "1.3";
const SESSION_PREFIX = "pw-tab-";

export class BrowserModel {
	readonly #sendToExtension: SendCommand;
	readonly #onError: (error: unknown) => void;
	/** Playwright's client while one is connected. Until then the model only observes: an event for Playwright is dropped. */
	#sendToCDPClient: SendToCDPClient | undefined;
	/** The tabs `chrome.tabs.onCreated` reported, attached or not. */
	readonly #knownTabs = new Map<number, Tab>();
	/** The known tabs the debugger is attached to, each with its session. */
	readonly #tabSessions = new Map<number, TabSession>();
	#autoAttach = false;
	#nextSessionId = 1;

	constructor(sendToExtension: SendCommand, onError: (error: unknown) => void) {
		this.#sendToExtension = sendToExtension;
		this.#onError = onError;
	}

	/** The tabs the extension reported, each with whether the relay attached the debugger to it. */
	tabs(): TRelayAttachment["tabs"] {
		return [...this.#knownTabs.values()].flatMap((tab) =>
			tab.id === undefined ? [] : [{ id: tab.id, ...(tab.title ? { title: tab.title } : {}), ...(tab.url ? { url: tab.url } : {}), attached: this.#tabSessions.has(tab.id) }],
		);
	}

	/** Connects Playwright's client, once the extension's first report is done, to receive the model's events. */
	connectOverCDP(sendToCDPClient: SendToCDPClient): void {
		this.#sendToCDPClient = sendToCDPClient;
	}

	/** Playwright's client closed: the debugger leaves every tab and the tabs stay in the model, so the next client attaches them
	 *  again. Chrome shows its debugging infobar only while a client drives a tab. */
	async disconnectOverCDP(): Promise<void> {
		this.#sendToCDPClient = undefined;
		this.#autoAttach = false;
		const attached = [...this.#tabSessions.keys()];
		this.#tabSessions.clear();
		await Promise.all(attached.map((tabId) => this.#sendToExtension("chrome.debugger.detach", [{ tabId }]).catch(this.#onError)));
	}

	onTabCreated(tab: Tab): void {
		if (tab.id === undefined) return;
		this.#knownTabs.set(tab.id, tab);
		if (this.#autoAttach) void this.#attachTab(tab.id).catch(this.#onError);
	}

	onTabRemoved(tabId: number): void {
		this.#knownTabs.delete(tabId);
		this.#detachTab(tabId);
	}

	onDebuggerEvent(source: DebuggerSession, method: string, params: unknown): void {
		if (source.tabId === undefined) return;
		const tabSession = this.#tabSessions.get(source.tabId);
		if (!tabSession) return;
		// A child session's commands route to the tab that holds it: `Target.attachedToTarget` adds one, and
		// `Target.detachedFromTarget` removes it.
		const childSessionId = (params as { sessionId?: string } | undefined)?.sessionId;
		if (method === "Target.attachedToTarget" && childSessionId) tabSession.childSessions.add(childSessionId);
		else if (method === "Target.detachedFromTarget" && childSessionId) tabSession.childSessions.delete(childSessionId);
		// A tab's own events carry the relay's session for it, and a child session's events keep their own.
		this.#emit({ sessionId: source.sessionId === undefined ? tabSession.sessionId : source.sessionId, method, params });
	}

	onDebuggerDetach(source: Debuggee): void {
		if (source.tabId !== undefined) this.#detachTab(source.tabId);
	}

	/** Playwright's `Target.setAutoAttach` on the root session: every known tab is attached, and each later one as it opens. */
	async enableAutoAttach(): Promise<void> {
		this.#autoAttach = true;
		await Promise.all([...this.#knownTabs.keys()].map((tabId) => this.#attachTab(tabId).catch(this.#onError)));
	}

	async createTarget(url: string | undefined): Promise<{ targetId: string | undefined }> {
		const tab = (await this.#sendToExtension("chrome.tabs.create", [{ url }])) as Tab | undefined;
		if (tab?.id === undefined) throw new Error(`the extension opened a tab at ${String(url)} without stating its id`);
		this.#knownTabs.set(tab.id, tab);
		const tabSession = await this.#attachTab(tab.id);
		return { targetId: tabSession.targetInfo?.targetId };
	}

	async closeTarget(targetId: string | undefined): Promise<{ success: boolean }> {
		const tabSession = targetId === undefined ? undefined : this.#findTabSession((session) => session.targetInfo?.targetId === targetId);
		if (!tabSession) return { success: false };
		await this.#sendToExtension("chrome.tabs.remove", [tabSession.tabId]);
		return { success: true };
	}

	getTargetInfo(sessionId: string | undefined): TTargetInfo | undefined {
		if (sessionId === undefined) return undefined;
		return this.#findTabSession((session) => session.sessionId === sessionId)?.targetInfo;
	}

	/** A browser-wide CDP command (`Storage.*`, `Browser.*`) through an attached tab: `chrome.debugger.sendCommand` takes a
	 *  target, and a browser-wide command returns the same result through any tab. */
	async sendBrowserCommand(method: string, params: unknown): Promise<unknown> {
		const tabSession = this.#tabSessions.values().next().value;
		if (!tabSession) throw new Error(`the browser-wide command ${method} needs an attached tab to carry it, and the debugger isn't attached to a tab`);
		return await this.#sendToExtension("chrome.debugger.sendCommand", [{ tabId: tabSession.tabId }, method, params]);
	}

	/** A CDP command from Playwright, sent to the tab its session resolves to: a relay session (`pw-tab-N`) routes by its tab,
	 *  and a child session (a worker, an out-of-process frame) routes to the tab that holds it and keeps its session. */
	async sendCommand(sessionId: string, method: string, params: unknown): Promise<unknown> {
		const own = this.#findTabSession((session) => session.sessionId === sessionId);
		const tabSession = own === undefined ? this.#findTabSession((session) => session.childSessions.has(sessionId)) : own;
		if (!tabSession) throw new Error(`the CDP session ${sessionId} of ${method} is the session of a tab outside the relay's model`);
		return await this.#sendToExtension("chrome.debugger.sendCommand", [{ tabId: tabSession.tabId, sessionId: own === undefined ? sessionId : undefined }, method, params]);
	}

	#emit(message: CDPMessage): void {
		this.#sendToCDPClient?.(message);
	}

	async #attachTab(tabId: number): Promise<TabSession> {
		const existing = this.#tabSessions.get(tabId);
		if (existing) return existing;
		await this.#sendToExtension("chrome.debugger.attach", [{ tabId }, DEBUGGER_VERSION]);
		const result = (await this.#sendToExtension("chrome.debugger.sendCommand", [{ tabId }, "Target.getTargetInfo"])) as { targetInfo?: TTargetInfo } | undefined;
		const targetInfo = result?.targetInfo;
		const sessionId = `${SESSION_PREFIX}${this.#nextSessionId++}`;
		const tabSession: TabSession = { tabId, sessionId, targetInfo, childSessions: new Set() };
		this.#tabSessions.set(tabId, tabSession);
		this.#emit({ method: "Target.attachedToTarget", params: { sessionId, targetInfo: { ...targetInfo, attached: true }, waitingForDebugger: false } });
		return tabSession;
	}

	#detachTab(tabId: number): void {
		const tabSession = this.#tabSessions.get(tabId);
		if (!tabSession) return;
		this.#tabSessions.delete(tabId);
		this.#emit({ method: "Target.detachedFromTarget", params: { sessionId: tabSession.sessionId, targetId: tabSession.targetInfo?.targetId } });
	}

	#findTabSession(predicate: (session: TabSession) => boolean): TabSession | undefined {
		return [...this.#tabSessions.values()].find(predicate);
	}
}
