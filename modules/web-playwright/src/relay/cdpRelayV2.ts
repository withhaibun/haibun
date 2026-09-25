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
 * haibun's style; `ManualPromise` replaced by `Promise.withResolvers` and a flag for whether it settled; `any` typed as
 * `unknown`; an unhandled error goes to the `onError` the protocol is given, in place of `logUnhandledError`.
 */

/**
 * Protocol v2: thin adapter between the extension wire protocol and the
 * CDP wire protocol. All tab-model state lives in `BrowserModel`; this file
 * only demultiplexes incoming extension events and dispatches CDP commands
 * to the model.
 *
 * Handshake: the extension pushes `chrome.tabs.onCreated` for each initial
 * tab, then `extension.initialized`. The relay does not process CDP
 * commands until `ready()` resolves, so `Target.setAutoAttach` is always
 * answered from a populated model.
 */

import { BrowserModel } from "./browserModel.js";

import type { SendCommand, SendToCDPClient } from "./browserModel.js";
import type { ExtensionEventsV2 } from "./protocol.js";
import type { TRelayAttachment } from "./relay-wire.js";

export class ExtensionProtocolV2 {
	private _model: BrowserModel;
	// Resolved by `extension.initialized`. Purely a handshake signal for the
	// relay — the model itself is oblivious to this phase.
	private _ready = Promise.withResolvers<void>();
	private _readySettled = false;

	constructor(sendCommand: SendCommand, onError: (error: unknown) => void) {
		this._model = new BrowserModel(sendCommand, onError);
		void this._ready.promise.catch(onError);
	}

	// Resolves once the extension has completed its initial handshake and the
	// relay may start processing CDP commands from Playwright.
	ready(): Promise<void> {
		return this._ready.promise;
	}

	/** The tabs the extension reported, each with whether the relay drives it. */
	tabs(): TRelayAttachment["tabs"] {
		return this._model.tabs();
	}

	connectOverCDP(sendToCDPClient: SendToCDPClient): void {
		this._model.connectOverCDP(sendToCDPClient);
	}

	// Called when the extension WebSocket closes. Rejects a pending `ready()`
	// promise so a blocked `establishExtensionConnection` bails out instead of
	// hanging forever.
	onExtensionDisconnect(reason: string): void {
		if (this._readySettled) return;
		this._readySettled = true;
		this._ready.reject(new Error(`Extension disconnected before initialization: ${reason}`));
	}

	handleExtensionEvent(method: string, params: unknown): void {
		switch (method) {
			case "chrome.debugger.onEvent": {
				const [source, cdpMethod, cdpParams] = params as ExtensionEventsV2["chrome.debugger.onEvent"]["params"];
				this._model.onDebuggerEvent(source, cdpMethod, cdpParams);
				break;
			}
			case "chrome.debugger.onDetach": {
				const [source] = params as ExtensionEventsV2["chrome.debugger.onDetach"]["params"];
				this._model.onDebuggerDetach(source);
				break;
			}
			case "chrome.tabs.onCreated": {
				const [tab] = params as ExtensionEventsV2["chrome.tabs.onCreated"]["params"];
				this._model.onTabCreated(tab);
				break;
			}
			case "chrome.tabs.onRemoved": {
				const [tabId] = params as ExtensionEventsV2["chrome.tabs.onRemoved"]["params"];
				this._model.onTabRemoved(tabId);
				break;
			}
			case "extension.initialized": {
				this._readySettled = true;
				this._ready.resolve();
				break;
			}
		}
	}

	// Handles a protocol-specific CDP command. Returns { result } if handled,
	// undefined to fall through to forwarding to the extension.
	async handleCDPCommand(method: string, params: unknown, sessionId: string | undefined): Promise<{ result: unknown } | undefined> {
		const named = params as { url?: string; targetId?: string } | undefined;
		switch (method) {
			case "Target.setAutoAttach": {
				if (sessionId) return undefined;
				await this._model.enableAutoAttach();
				return { result: {} };
			}
			case "Target.createTarget":
				return { result: await this._model.createTarget(named?.url) };
			case "Target.closeTarget":
				return { result: await this._model.closeTarget(named?.targetId) };
			case "Target.getTargetInfo":
				return { result: this._model.getTargetInfo(sessionId) };
		}
		return undefined;
	}

	async forwardToExtension(method: string, params: unknown, sessionId: string | undefined): Promise<unknown> {
		// Browser-level commands (Storage.*, Browser.*) have no sessionId.
		if (!sessionId) return await this._model.sendBrowserCommand(method, params);
		return await this._model.sendCommand(sessionId, method, params);
	}
}
