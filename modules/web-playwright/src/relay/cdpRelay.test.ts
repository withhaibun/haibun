/**
 * The relay between Playwright and a person's extension: Playwright's CDP is answered from the relay's tab model where
 * it can be, and carried to the extension as chrome.* calls otherwise; the extension's answers and events come back.
 * One extension and one CDP client at a time, and a browser to drive only while one is attached.
 */
import { describe, it, expect } from "vitest";
import { BrowserRelay } from "./cdpRelay.js";
import type { TRelayMessage } from "./relay-wire.js";
import type { CDPMessage } from "./browserModel.js";

const TAB = { id: 7, index: 0, windowId: 1, active: true, pinned: false, url: "http://example.com/" };

const HOLDER = "did:key:zExtension";

/** An extension `holder` attached, held by the relay: what the relay sent it, and a way to end the attachment. */
function attached(relay: BrowserRelay, holder = HOLDER) {
	const sent: TRelayMessage[] = [];
	const ending = new AbortController();
	const held = relay.attach(
		(message) => void sent.push(message),
		ending.signal,
		() => undefined,
		holder,
	);
	return { sent, end: () => ending.abort(), held };
}

/** Playwright's side: what the relay sent it, a CDP command to send, and closing its client. */
function driven(relay: BrowserRelay) {
	const received: CDPMessage[] = [];
	let closed: string | undefined;
	const transport = relay.transport();
	transport.onmessage = (message) => void received.push(message as CDPMessage);
	transport.onclose = (reason) => void (closed = reason);
	return {
		received,
		send: (id: number, method: string, params?: object, sessionId?: string) => transport.send({ id, method, params, sessionId }),
		close: () => transport.close(),
		closed: () => closed,
	};
}

/** Let the relay's awaited handoffs run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the browser relay", () => {
	it("doesn't drive a browser while one isn't attached, and holds one extension at a time", async () => {
		const reported: unknown[] = [];
		const relay = new BrowserRelay((e) => void reported.push(e));
		expect(() => relay.transport()).toThrow(/a browser isn't attached/);
		const first = attached(relay);
		await expect(
			relay.attach(
				() => undefined,
				new AbortController().signal,
				() => undefined,
				"did:key:zAnother",
			),
		).rejects.toThrow(/already attached/);
		driven(relay);
		expect(() => relay.transport(), "and one CDP client").toThrow(/already driven/);
		first.end();
		await first.held;
		expect(() => relay.transport(), "the attachment ended").toThrow(/a browser isn't attached/);
		expect(reported.map(String), "ended before its handshake, which is reported").toEqual([
			"Error: Extension disconnected before initialization: the extension ended its attachment",
		]);
	});

	it("answers Playwright once the extension's handshake is done, attaching its tabs and forwarding the rest", async () => {
		const reported: unknown[] = [];
		const relay = new BrowserRelay((e) => void reported.push(e));
		expect(relay.attachment(), "the relay doesn't hold an attachment before an extension attaches").toEqual({ attached: false, tabs: [] });
		const extension = attached(relay);
		const playwright = driven(relay);
		playwright.send(1, "Browser.getVersion");
		await settle();
		expect(playwright.received, "the relay doesn't return a result before the handshake").toEqual([]);
		relay.receive([
			{ method: "chrome.tabs.onCreated", params: [TAB] },
			{ method: "extension.initialized", params: [] },
		]);
		await settle();
		expect(playwright.received[0]).toMatchObject({ id: 1, result: { protocolVersion: "1.3" } });

		playwright.send(2, "Target.setAutoAttach", { autoAttach: true });
		await settle();
		expect(extension.sent[0], "the relay attaches the tab it knows").toEqual({ id: 1, method: "chrome.debugger.attach", params: [{ tabId: 7 }, "1.3"] });
		relay.receive([{ id: 1, result: {} }]);
		await settle();
		expect(extension.sent[1]).toEqual({ id: 2, method: "chrome.debugger.sendCommand", params: [{ tabId: 7 }, "Target.getTargetInfo"] });
		relay.receive([{ id: 2, result: { targetInfo: { targetId: "T7", type: "page" } } }]);
		await settle();
		expect(playwright.received).toContainEqual({
			method: "Target.attachedToTarget",
			params: { sessionId: "pw-tab-1", targetInfo: { targetId: "T7", type: "page", attached: true }, waitingForDebugger: false },
		});
		expect(playwright.received).toContainEqual({ id: 2, result: {} });
		expect(relay.attachment(), "what the relay holds: the holder, and the tab it drives").toEqual({
			attached: true,
			holder: HOLDER,
			tabs: [{ id: TAB.id, url: TAB.url, attached: true }],
		});

		playwright.send(3, "Runtime.evaluate", { expression: "1+1" }, "pw-tab-1");
		await settle();
		expect(extension.sent[2], "a tab's command goes to its tab").toEqual({
			id: 3,
			method: "chrome.debugger.sendCommand",
			params: [{ tabId: 7 }, "Runtime.evaluate", { expression: "1+1" }],
		});
		relay.receive([
			{ id: 3, result: { result: { value: 2 } } },
			{ method: "chrome.debugger.onEvent", params: [{ tabId: 7 }, "Page.loadEventFired", { timestamp: 1 }] },
		]);
		await settle();
		expect(playwright.received).toContainEqual({ id: 3, sessionId: "pw-tab-1", result: { result: { value: 2 } } });
		expect(playwright.received, "a tab's event reaches Playwright on the tab's session").toContainEqual({
			sessionId: "pw-tab-1",
			method: "Page.loadEventFired",
			params: { timestamp: 1 },
		});
		expect(reported).toEqual([]);
		extension.end();
		await extension.held;
	});

	it("carries the extension's refusal of a command to Playwright, and ends Playwright's side with the attachment", async () => {
		const reported: unknown[] = [];
		const relay = new BrowserRelay((e) => void reported.push(e));
		const extension = attached(relay);
		const playwright = driven(relay);
		relay.receive([{ method: "extension.initialized", params: [] }]);
		playwright.send(1, "Storage.getCookies");
		await settle();
		expect(playwright.received[0], "a browser command without an attached tab is refused").toMatchObject({ id: 1, error: { message: expect.stringMatching(/No attached tab/) } });
		expect(() => relay.receive([{ id: 99, result: {} }]), "an answer to a command never sent").toThrow(/didn't send command 99/);
		extension.end();
		await extension.held;
		expect(playwright.closed(), "Playwright is told the extension went").toMatch(/Extension disconnected/);
		expect(() => relay.receive([{ method: "extension.initialized", params: [] }]), "and a browser isn't attached to answer").toThrow(/a browser isn't attached/);
	});

	it("ends a holder's attachment when that holder attaches again, and refuses a caller that didn't prove a key", async () => {
		const relay = new BrowserRelay(() => undefined);
		const first = attached(relay);
		const playwright = driven(relay);
		const again = attached(relay);
		await first.held;
		expect(playwright.closed(), "Playwright's side of the first is closed").toBe("Extension disconnected: the extension attached again");
		expect(() => driven(relay), "and the second is driven").not.toThrow();
		await expect(
			relay.attach(
				() => undefined,
				new AbortController().signal,
				() => undefined,
				undefined,
			),
		).rejects.toThrow(/already attached/);
		again.end();
		await again.held;
	});

	it("ends the attachment when Playwright's client closes, telling the extension to take the debugger off its tabs", async () => {
		const relay = new BrowserRelay(() => undefined);
		const extension = attached(relay);
		const playwright = driven(relay);
		relay.receive([{ method: "extension.initialized", params: [] }]);
		playwright.close();
		await extension.held;
		expect(playwright.closed(), "Playwright's side is told it closed").toBe("Playwright's client closed");
		expect(() => relay.transport(), "and a browser isn't attached").toThrow(/a browser isn't attached/);
	});
});
