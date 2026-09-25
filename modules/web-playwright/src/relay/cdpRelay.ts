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
 * Derived from Playwright 7b4b3b0828, packages/playwright-core/src/tools/mcp/cdpRelay.ts: the dispatch of
 * `CDPRelayServer` (`_handlePlaywrightMessage`, `_handleCDPCommand`, `_sendToCDPClient`) and of `ExtensionConnection`
 * (its commands and their answers). Changed: formatted to haibun's style; the WebSocket server, its two endpoints, the
 * spawn of a local Chrome, the connect page, the browser registry, the connection timeout and `debug` are dropped.
 * Playwright's side is a `ConnectOverCDPTransport` in the instance's process, and the extension's side is the call that
 * holds it (`attach`) and the calls it answers through (`receive`). `any` is typed as `unknown`.
 */

import type { ConnectOverCDPTransport } from "playwright";
import { ExtensionProtocolV2 } from "./cdpRelayV2.js";
import type { CDPMessage } from "./browserModel.js";
import type { TRelayAttachment, TRelayMessage } from "./relay-wire.js";

type CDPCommand = { id: number; sessionId?: string; method: string; params?: unknown };

type TPending = { resolve: (result: unknown) => void; reject: (error: Error) => void; error: Error };
type TExtension = {
	emit: (message: TRelayMessage) => void;
	holder: string | undefined;
	pending: Map<number, TPending>;
	lastId: number;
	protocol: ExtensionProtocolV2;
	end: (reason: string) => void;
};

/**
 * A browser a person runs, driven through their extension: Playwright sends CDP to the relay, which answers what it
 * can from its tab model and carries the rest to the extension as the chrome.* calls that do it. One extension is held
 * at a time, for as long as the call that attached it stays open, and one CDP client drives it. The holder that attached
 * it may attach again, which ends the attachment it held: the server learns that a call ended only once its connection
 * closes, so an extension that ends its attachment and attaches again may arrive first.
 */
export class BrowserRelay {
	private extension: TExtension | undefined;
	private cdpClient: ConnectOverCDPTransport | undefined;

	constructor(private readonly onError: (error: unknown) => void) {}

	/** What the relay holds: the extension attached, the key that attached it, and its tabs. */
	attachment(): TRelayAttachment {
		const extension = this.extension;
		if (!extension) return { attached: false, tabs: [] };
		return { attached: true, ...(extension.holder ? { holder: extension.holder } : {}), tabs: extension.protocol.tabs() };
	}

	/** Hold one extension, attached by `holder`, until `signal` aborts or Playwright's client closes: each command for it
	 *  goes out through `emit`, and `held` is told once the relay holds it. Another holder's extension is refused while
	 *  one is held. */
	async attach(emit: (message: TRelayMessage) => void, signal: AbortSignal, held: () => void, holder: string | undefined): Promise<void> {
		const attached = this.extension;
		if (attached && (holder === undefined || attached.holder !== holder)) throw new Error("a browser is already attached: the relay holds one extension at a time");
		if (attached) this.detach(attached, "the extension attached again");
		const ended = Promise.withResolvers<string>();
		const extension: TExtension = {
			emit,
			holder,
			pending: new Map(),
			lastId: 0,
			protocol: new ExtensionProtocolV2((method, params) => this.command(method, params), this.onError),
			end: (reason) => ended.resolve(reason),
		};
		this.extension = extension;
		held();
		if (signal.aborted) ended.resolve("the extension ended its attachment");
		else signal.addEventListener("abort", () => ended.resolve("the extension ended its attachment"), { once: true });
		this.detach(extension, await ended.promise);
	}

	/** What the attached extension sends: the answer to each command it was sent, and the chrome events of its tabs. */
	receive(messages: readonly TRelayMessage[]): void {
		const extension = this.extension;
		if (!extension) throw new Error("no browser is attached to answer the relay");
		for (const message of messages) {
			if (message.id !== undefined) {
				const pending = extension.pending.get(message.id);
				if (!pending) throw new Error(`the relay sent no command ${message.id} for the extension to answer`);
				extension.pending.delete(message.id);
				if (message.error) {
					pending.error.message = message.error;
					pending.reject(pending.error);
				} else pending.resolve(message.result);
			} else if (message.method) extension.protocol.handleExtensionEvent(message.method, message.params);
		}
	}

	/** Playwright's side: the transport `connectOverCDP` drives the attached browser through. */
	transport(): ConnectOverCDPTransport {
		const extension = this.extension;
		if (!extension) throw new Error("no browser is attached: the relay holds no extension, so there is no browser to drive");
		if (this.cdpClient) throw new Error("the attached browser is already driven: the relay takes one CDP client");
		// Playwright's client closing ends the attachment, as upstream closes the extension's connection with it: the
		// extension is told, and takes the debugger off its tabs.
		const client: ConnectOverCDPTransport = {
			send: (message) => void this.handlePlaywrightMessage(extension, message as CDPCommand),
			close: () => {
				if (this.cdpClient !== client) return;
				this.cdpClient = undefined;
				client.onclose?.("Playwright's client closed");
				extension.end("Playwright's client closed");
			},
		};
		this.cdpClient = client;
		extension.protocol.connectOverCDP((message) => client.onmessage?.(message));
		return client;
	}

	private command(method: string, params: unknown): Promise<unknown> {
		const extension = this.extension;
		if (!extension) throw new Error("Extension not connected");
		const id = ++extension.lastId;
		extension.emit({ id, method, params });
		const error = new Error(`Protocol error: ${method}`);
		return new Promise((resolve, reject) => {
			extension.pending.set(id, { resolve, reject, error });
		});
	}

	/** End an attachment: the call that holds it returns, its commands are refused, and Playwright's side is closed. */
	private detach(extension: TExtension, reason: string): void {
		if (this.extension !== extension) return;
		this.extension = undefined;
		extension.end(reason);
		for (const pending of extension.pending.values()) pending.reject(new Error(reason));
		extension.pending.clear();
		extension.protocol.onExtensionDisconnect(reason);
		const client = this.cdpClient;
		this.cdpClient = undefined;
		client?.onclose?.(`Extension disconnected: ${reason}`);
	}

	private async handlePlaywrightMessage(extension: TExtension, message: CDPCommand): Promise<void> {
		const { id, sessionId, method, params } = message;
		try {
			// The relay does not process CDP commands until the extension's initial handshake is done.
			await extension.protocol.ready();
			const result = await this.handleCDPCommand(extension, method, params, sessionId);
			this.sendToCDPClient({ id, sessionId, result });
		} catch (e) {
			this.sendToCDPClient({ id, sessionId, error: { message: (e as Error).message } });
		}
	}

	private async handleCDPCommand(extension: TExtension, method: string, params: unknown, sessionId: string | undefined): Promise<unknown> {
		switch (method) {
			case "Browser.getVersion": {
				return {
					protocolVersion: "1.3",
					product: "Chrome/Extension-Bridge",
					userAgent: "CDP-Bridge-Server/1.0.0",
				};
			}
			case "Browser.setDownloadBehavior": {
				return {};
			}
		}
		const handled = await extension.protocol.handleCDPCommand(method, params, sessionId);
		if (handled) return handled.result;
		return await extension.protocol.forwardToExtension(method, params, sessionId);
	}

	private sendToCDPClient(message: CDPMessage): void {
		this.cdpClient?.onmessage?.(message);
	}
}
