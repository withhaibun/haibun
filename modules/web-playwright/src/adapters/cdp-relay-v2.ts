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
 * `logUnhandledError`; the `Browser.*` commands of `CDPRelayServer._handleCDPCommand` join this file's table, and the
 * forwarding methods to `BrowserModel` are replaced by its `model`.
 */

/**
 * The second version of the extension's protocol, between its wire and CDP's: the tab model is `BrowserModel`'s, and this
 * file sends the extension's events and Playwright's commands to it. `handleCDPCommand` is the one table of the commands the
 * relay handles, and it carries every other command to the extension.
 *
 * The extension reports `chrome.tabs.onCreated` for each tab it starts with, then `extension.initialized`. The relay holds
 * Playwright's CDP until `ready()` resolves, so `Target.setAutoAttach` reads a full model.
 */

import { z } from "zod";
import { BrowserModel } from "./browser-model.js";

import type { SendCommand } from "./browser-model.js";
import { TabSchema } from "../domains/relay.js";

const DebuggeeSchema = z.object({ tabId: z.number().optional(), extensionId: z.string().optional(), targetId: z.string().optional() });
const DebuggerSessionSchema = DebuggeeSchema.extend({ sessionId: z.string().optional() });
const DebuggerOnEventParamsSchema = z.tuple([DebuggerSessionSchema, z.string(), z.record(z.string(), z.unknown()).optional()]);
const DebuggerOnDetachParamsSchema = z.tuple([DebuggeeSchema, z.unknown().optional(), z.unknown().optional()]);
const TabsOnCreatedParamsSchema = z.tuple([TabSchema]);
const TabsOnRemovedParamsSchema = z.tuple([z.number(), z.unknown().optional()]);
const TargetParamsSchema = z.object({ url: z.string().optional(), targetId: z.string().optional() });

export class ExtensionProtocolV2 {
	/** The tab model: the tabs the extension reported, and Playwright's connection to them. */
	readonly model: BrowserModel;
	/** Resolved by `extension.initialized`: a signal to the relay alone, which the model leaves out of account. */
	readonly #ready = Promise.withResolvers<void>();
	#readySettled = false;

	constructor(sendCommand: SendCommand, onError: (error: unknown) => void) {
		this.model = new BrowserModel(sendCommand, onError);
		void this.#ready.promise.catch(onError);
	}

	/** Resolves once the extension's first report is done, and the relay may handle Playwright's CDP. */
	ready(): Promise<void> {
		return this.#ready.promise;
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
				const [source, cdpMethod, cdpParams] = DebuggerOnEventParamsSchema.parse(params);
				this.model.onDebuggerEvent(source, cdpMethod, cdpParams);
				break;
			}
			case "chrome.debugger.onDetach": {
				const [source] = DebuggerOnDetachParamsSchema.parse(params);
				this.model.onDebuggerDetach(source);
				break;
			}
			case "chrome.tabs.onCreated": {
				const [tab] = TabsOnCreatedParamsSchema.parse(params);
				this.model.onTabCreated(tab);
				break;
			}
			case "chrome.tabs.onRemoved": {
				const [tabId] = TabsOnRemovedParamsSchema.parse(params);
				this.model.onTabRemoved(tabId);
				break;
			}
			case "extension.initialized": {
				this.#readySettled = true;
				this.#ready.resolve();
				break;
			}
		}
	}

	/** Returns the result of a CDP command: the relay handles the browser's and the targets' commands, and the extension
	 *  carries out each other command. */
	async handleCDPCommand(method: string, params: unknown, sessionId: string | undefined): Promise<unknown> {
		switch (method) {
			case "Browser.getVersion":
				return { protocolVersion: "1.3", product: "Chrome/Extension-Bridge", userAgent: "CDP-Bridge-Server/1.0.0" };
			// The person's browser keeps its own downloads, and closing the connected browser ends Playwright's client, never
			// the person's browser.
			case "Browser.setDownloadBehavior":
			case "Browser.close":
				return {};
			case "Target.setAutoAttach":
				// A session's own auto-attach is the extension's to carry out.
				if (sessionId) break;
				await this.model.enableAutoAttach();
				return {};
			case "Target.createTarget":
				return await this.model.createTarget(TargetParamsSchema.optional().parse(params)?.url);
			case "Target.closeTarget":
				return await this.model.closeTarget(TargetParamsSchema.optional().parse(params)?.targetId);
			case "Target.getTargetInfo":
				return this.model.getTargetInfo(sessionId);
		}
		// A browser-wide command (`Storage.*`, `Browser.*`) comes without a session.
		if (sessionId === undefined) return await this.model.sendBrowserCommand(method, params);
		return await this.model.sendCommand(sessionId, method, params);
	}
}
