/**
 * The extension's side of the relay attaches the debugger only to the tabs the person gave it: the tab they chose, a
 * tab opened from an attached tab, and a tab the relay created. A command naming any other tab they have open is
 * refused, stating which tab and why. Run against a real Chromium through the chrome.* fake, over an in-memory channel.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TRelayMessage } from "../relay/relay-wire.js";
import type { Tab } from "../relay/protocol.js";
import { ChromeOverCdp } from "./chrome.test-fake.js";
import { RelayConnection, type TRelayChannel } from "./relayConnection.js";

let chrome: ChromeOverCdp;

/** An in-memory channel: the relay's commands in, and each answer and event the extension sends. */
function channelled() {
	const sent: TRelayMessage[] = [];
	const answers = new Map<number, (message: TRelayMessage) => void>();
	const channel: TRelayChannel = {
		open: true,
		send: (message) => {
			sent.push(message);
			if (message.id !== undefined) answers.get(message.id)?.(message);
		},
		close: () => undefined,
	};
	let nextId = 1;
	/** Send a command the way the relay does, and resolve with the extension's answer. */
	const command = (method: string, params: unknown[]) =>
		new Promise<TRelayMessage>((resolve) => {
			const id = nextId++;
			answers.set(id, resolve);
			channel.onmessage?.({ id, method, params });
		});
	return { channel, sent, command };
}

beforeAll(async () => {
	chrome = await ChromeOverCdp.launch();
}, 60_000);

afterAll(() => chrome.close());

describe("the tabs the extension lets the relay attach", () => {
	it("are the chosen tab, one opened from it, and one the relay created, and never another tab the person has open", { timeout: 30_000 }, async () => {
		const { channel, sent, command } = channelled();
		const connection = new RelayConnection(channel, chrome, () => undefined);
		const chosen = chrome.firstTab();
		const other = await chrome.tabs.create({ url: "about:blank" });
		connection.attachTab(chosen);

		expect((await command("chrome.debugger.attach", [{ tabId: chosen.id }, "1.3"])).error, "the tab the person chose").toBeUndefined();
		expect((await command("chrome.debugger.attach", [{ tabId: other.id }, "1.3"])).error, "a tab the person has open and didn't give").toBe(
			`chrome.debugger.attach: tab ${other.id} is not a tab the person attached, one opened from an attached tab, or one the relay created`,
		);
		expect((await command("chrome.debugger.sendCommand", [{ tabId: other.id }, "Runtime.evaluate", { expression: "1" }])).error).toMatch(/is not a tab the person attached/);

		const opened = new Promise<Tab>((resolve) => chrome.tabs.onCreated.addListener((tab) => resolve(tab)));
		await command("chrome.debugger.sendCommand", [{ tabId: chosen.id }, "Runtime.evaluate", { expression: "window.open('about:blank')" }]);
		const popup = await opened;
		expect(popup.openerTabId, "opened from the chosen tab").toBe(chosen.id);
		expect(
			sent.some((m) => m.method === "chrome.tabs.onCreated"),
			"and reported to the relay",
		).toBe(true);
		expect((await command("chrome.debugger.attach", [{ tabId: popup.id }, "1.3"])).error, "a tab opened from an attached one").toBeUndefined();

		const created = (await command("chrome.tabs.create", [{ url: "about:blank" }])).result as Tab;
		expect((await command("chrome.debugger.attach", [{ tabId: created.id }, "1.3"])).error, "a tab the relay created").toBeUndefined();
		connection.close("done");
	});
});
