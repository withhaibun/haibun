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
 * Derived from Playwright 7b4b3b0828, packages/playwright-core/src/tools/mcp/cdpRelayV2.ts. Changed: formatted to
 * haibun's style; its comments rewritten; `ManualPromise` replaced by `Promise.withResolvers` and a flag for whether it
 * settled; `any` typed as `unknown`; an unhandled error reaches the `onError` the protocol takes, in place of
 * `logUnhandledError`.
 */

/**
 * The second version of the extension's protocol, between its wire and CDP's: the tab model is `BrowserModel`'s, and this
 * file sends the extension's events and Playwright's commands to it.
 *
 * The extension reports `chrome.tabs.onCreated` for each tab it starts with, then `extension.initialized`. The relay holds
 * Playwright's CDP until `ready()` resolves, so `Target.setAutoAttach` reads a full model.
 */

import { BrowserModel } from "./browser-model.js";

import type { SendCommand, SendToCDPClient } from "./browser-model.js";
import type { Tab, TChromeEvents } from "../ports.js";
import type { TRelayAttachment } from "../domains/relay.js";

export class ExtensionProtocolV2 {
	readonly #model: BrowserModel;
	/** Resolved by `extension.initialized`: a signal to the relay alone, which the model leaves out of account. */
	readonly #ready = Promise.withResolvers<void>();
	#readySettled = false;

	constructor(sendCommand: SendCommand, onError: (error: unknown) => void) {
		this.#model = new BrowserModel(sendCommand, onError);
		void this.#ready.promise.catch(onError);
	}

	/** Resolves once the extension's first report is done, and the relay may handle Playwright's CDP. */
	ready(): Promise<void> {
		return this.#ready.promise;
	}

	/** The tabs the extension reported, each with whether the relay drives it. */
	tabs(): TRelayAttachment["tabs"] {
		return this.#model.tabs();
	}

	connectOverCDP(sendToCDPClient: SendToCDPClient): void {
		this.#model.connectOverCDP(sendToCDPClient);
	}

	/** A tab the relay opened, which the relay may drive from now. */
	rememberTab(tab: Tab): void {
		this.#model.onTabCreated(tab);
	}

	disconnectOverCDP(): Promise<void> {
		return this.#model.disconnectOverCDP();
	}

	/** The extension's attachment ended: a `ready()` that is still pending is refused, so a command that waits on it fails. */
	onExtensionDisconnect(reason: string): void {
		if (this.#readySettled) return;
		this.#readySettled = true;
		this.#ready.reject(new Error(`the extension disconnected before its first report of its tabs ended: ${reason}`));
	}

	handleExtensionEvent(method: string, params: unknown): void {
		switch (method) {
			case "chrome.debugger.onEvent": {
				const [source, cdpMethod, cdpParams] = params as TChromeEvents["chrome.debugger.onEvent"]["params"];
				this.#model.onDebuggerEvent(source, cdpMethod, cdpParams);
				break;
			}
			case "chrome.debugger.onDetach": {
				const [source] = params as TChromeEvents["chrome.debugger.onDetach"]["params"];
				this.#model.onDebuggerDetach(source);
				break;
			}
			case "chrome.tabs.onCreated": {
				const [tab] = params as TChromeEvents["chrome.tabs.onCreated"]["params"];
				this.#model.onTabCreated(tab);
				break;
			}
			case "chrome.tabs.onRemoved": {
				const [tabId] = params as TChromeEvents["chrome.tabs.onRemoved"]["params"];
				this.#model.onTabRemoved(tabId);
				break;
			}
			case "extension.initialized": {
				this.#readySettled = true;
				this.#ready.resolve();
				break;
			}
		}
	}

	/** A CDP command the protocol handles itself, with its result, or undefined for one the extension carries out. */
	async handleCDPCommand(method: string, params: unknown, sessionId: string | undefined): Promise<{ result: unknown } | undefined> {
		const named = params as { url?: string; targetId?: string } | undefined;
		switch (method) {
			case "Target.setAutoAttach": {
				if (sessionId) return undefined;
				await this.#model.enableAutoAttach();
				return { result: {} };
			}
			case "Target.createTarget":
				return { result: await this.#model.createTarget(named?.url) };
			case "Target.closeTarget":
				return { result: await this.#model.closeTarget(named?.targetId) };
			case "Target.getTargetInfo":
				return { result: this.#model.getTargetInfo(sessionId) };
		}
		return undefined;
	}

	async forwardToExtension(method: string, params: unknown, sessionId: string | undefined): Promise<unknown> {
		// A browser-wide command (`Storage.*`, `Browser.*`) comes without a session.
		if (sessionId === undefined) return await this.#model.sendBrowserCommand(method, params);
		return await this.#model.sendCommand(sessionId, method, params);
	}
}
