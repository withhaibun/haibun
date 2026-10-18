/**
 * A feature's session with the browser, over stand-in pages: the order of the actions run on a page, and when each page
 * comes to the front.
 */
import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { runInStep } from "@haibun/core/lib/domains/capability-context.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import type { TBrowserPages } from "../ports.js";
import { BrowserSession } from "./browser-session.js";

/** A stand-in page: it records each time it comes to the front, and runs the listeners a test fires on it. */
function standInPage(name: string, fronted: string[]) {
	const listeners = new Map<string, ((...args: unknown[]) => unknown)[]>();
	const page = {
		bringToFront: () => Promise.resolve(void fronted.push(name)),
		on: (event: string, listener: (...args: unknown[]) => unknown) => void listeners.set(event, [...(listeners.get(event) ?? []), listener]),
		waitForLoadState: () => Promise.resolve(),
	};
	const fire = (event: string, ...args: unknown[]) => Promise.all((listeners.get(event) ?? []).map((listener) => listener(...args)));
	return { page: page as unknown as Page, fire };
}

/** A session whose pages are stand-ins, one per tab, opened as a step first reaches each tab. */
function sessionOverStandIns(relayed = false) {
	const fronted: string[] = [];
	const tabs = new Map<number, ReturnType<typeof standInPage>>();
	const tab = (at: number) => {
		const held = tabs.get(at);
		if (held) return held;
		const opened = standInPage(`tab ${at}`, fronted);
		tabs.set(at, opened);
		return opened;
	};
	const pages: TBrowserPages = {
		hasPage: (_featureNum, at) => tabs.has(at),
		page: (_featureNum, at) => Promise.resolve(tab(at).page),
		registerPopup: (_featureNum, at, popup) => void tabs.set(at, { page: popup, fire: () => Promise.resolve([]) }),
		isAdopted: () => false,
		context: () => undefined,
		closeContext: () => Promise.resolve(),
		disconnect: () => Promise.resolve(),
		close: () => Promise.resolve(),
	};
	const session = new BrowserSession({ world: getDefaultWorld(), openPages: () => pages, captureVideo: false, relayed: () => relayed, twin: () => undefined });
	return { session, fronted, tab };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("a session's actions on a page", () => {
	it("run one at a time on a page that several callers share", async () => {
		const { session } = sessionOverStandIns();
		const order: string[] = [];
		const act = (name: string) =>
			session.withPage(async () => {
				order.push(`${name} starts`);
				await tick();
				order.push(`${name} ends`);
			});
		await Promise.all([act("first"), act("second")]);
		expect(order).toEqual(["first starts", "first ends", "second starts", "second ends"]);
	});

	it("run an action nested in another at once, rather than behind it", async () => {
		const { session } = sessionOverStandIns();
		expect(await session.withPage(() => session.withPage(() => "nested ran"))).toBe("nested ran");
	});

	it("run the next action after one that failed", async () => {
		const { session } = sessionOverStandIns();
		const failed = session.withPage(() => Promise.reject(new Error("the action failed")));
		const next = session.withPage(() => "next ran");
		await expect(failed).rejects.toThrow("the action failed");
		expect(await next).toBe("next ran");
	});
});

describe("the page in front (PF32)", () => {
	it("comes to the front for its first action, and stays there for the actions after it", async () => {
		const { session, fronted } = sessionOverStandIns();
		await session.withPage(() => "first");
		await session.withPage(() => "second");
		await session.withPage(() => "third");
		expect(fronted).toEqual(["tab 0"]);
	});

	it("comes back to the front where another tab took the front from it", async () => {
		const { session, fronted } = sessionOverStandIns();
		await session.withPage(() => "on the first tab");
		session.newTab();
		await session.withPage(() => "on the second tab");
		await session.withPage(() => "on the second tab again");
		session.tab = 0;
		await session.withPage(() => "back on the first tab");
		expect(fronted).toEqual(["tab 0", "tab 1", "tab 0"]);
	});

	it("comes to the front again after a popup opens, since the browser may put the popup in front", async () => {
		const { session, fronted, tab } = sessionOverStandIns();
		await session.withPage(() => "before the popup");
		await tab(0).fire("popup", standInPage("popup", fronted).page);
		session.tab = 0;
		await session.withPage(() => "after the popup");
		expect(fronted).toEqual(["tab 0", "tab 0"]);
	});

	it("comes to the front again after the relayed browser is let go, whose next connection may show another tab", async () => {
		const { session, fronted } = sessionOverStandIns(true);
		const step = { seqPath: "0.1.1", reportsAt: undefined };
		await runInStep(step, () => session.withPage(() => "before the release"));
		await session.releaseAfter({ ...step, outermost: step.seqPath });
		await runInStep(step, () => session.withPage(() => "after the release"));
		expect(fronted).toEqual(["tab 0", "tab 0"]);
	});
});
