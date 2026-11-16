/** What a step does to the page: keys, text, fields, clicks, uploads, the window's size, the page's requests, its timeouts and its dialogs. */
import type { Dialog } from "playwright";
import type { TActionResult, TStepValue } from "@haibun/core/lib/domains/protocol.js";
import { errorDetail } from "@haibun/core/lib/domains/util.js";
import { REQUEST_STATE, DOMAIN_PAGE_TEST_ID, type TFindWay } from "../domains/web-playwright.js";
import { locatorOf, wayLocator } from "../derivations/locators.js";
import type { BrowserSession } from "./browser-session.js";
import { attempted, locateByDomain, locateWith } from "./locate.js";

/** What a dialog the page opened holds, as the step that accepts it keeps it. */
export type TDialogSays = { defaultValue: string; message: string; type: string };

export const press = (session: BrowserSession, key: string): Promise<TActionResult> => attempted(`press "${key}"`, () => session.withPage((page) => page.keyboard.press(key)));

export const typeText = (session: BrowserSession, text: string): Promise<void> => session.withPage((page) => page.keyboard.type(text));

/** Enters `what` into a field: a select takes the option of that value, or else of that label, and any other field is filled. */
export const enterInto = (session: BrowserSession, what: string, field: TStepValue): Promise<TActionResult> =>
	attempted(`enter "${what}" into ${String(field.value)}`, () =>
		session.withScope(async (scope) => {
			const locator = locateByDomain(scope, field);
			if ((await locator.evaluate((element) => element.tagName.toLowerCase())) !== "select") return void (await locator.fill(what));
			await locator.selectOption({ value: what }).catch((byValue: unknown) =>
				locator.selectOption({ label: what }).catch((byLabel: unknown) => {
					throw new Error(`the select doesn't hold an option whose value or label is "${what}": ${errorDetail(byValue)}; ${errorDetail(byLabel)}`);
				}),
			);
		}),
	);

export const selectOption = (session: BrowserSession, option: string, field: TStepValue): Promise<TActionResult> =>
	attempted(`select "${option}" for ${String(field.value)}`, () => session.withScope(async (scope) => void (await locateByDomain(scope, field).selectOption({ label: option }))));

/** Clicks a target once it is visible and takes the click. */
export const click = (session: BrowserSession, target: TStepValue): Promise<TActionResult> =>
	attempted(`click ${String(target.value)}`, () => session.withScope((scope) => locateByDomain(scope, target).click()));

/** Moves the pointer over the element a target locates, as a reader pointing at it does; the pointer leaves it for the next target. */
export const hoverOver = (session: BrowserSession, target: TStepValue): Promise<TActionResult> =>
	attempted(`hover over ${String(target.value)}`, () => session.withScope((scope) => locateByDomain(scope, target).first().hover()));

/** Waits for the first element a target locates: a test id until it is attached to the DOM, since a panel that shows the key
 *  states it before a reader takes it, and every other locator until it is visible. */
export const waitFor = (session: BrowserSession, target: TStepValue): Promise<TActionResult> =>
	attempted(`wait for ${String(target.value)}`, () =>
		session.withScope(async (scope) => {
			const state = locatorOf(target).domain === DOMAIN_PAGE_TEST_ID ? "attached" : "visible";
			await locateByDomain(scope, target).first().waitFor({ state });
		}),
	);

/** Waits until the first element a target locates is gone: detached or hidden, so a page that took it away is proved at once. */
export const waitGone = (session: BrowserSession, target: TStepValue): Promise<TActionResult> =>
	attempted(`wait until ${String(target.value)} is gone`, () => session.withScope((scope) => locateByDomain(scope, target).first().waitFor({ state: "hidden" })));

/** Turns the mouse wheel over the element a target locates, up by the element's own height, as a reader reading back does. */
export const scrollUpAScreen = (session: BrowserSession, target: TStepValue): Promise<TActionResult> =>
	attempted(`scroll ${String(target.value)} up a screen`, () =>
		session.withScope(async (scope) => {
			const located = locateByDomain(scope, target).first();
			await located.hover();
			await located.page().mouse.wheel(0, -(await located.evaluate((element) => element.clientHeight)));
		}),
	);

/** Clicks what a way finds. A click by way matches part of the element's text, as Playwright does by default. */
export const clickBy = (session: BrowserSession, target: string, way: TFindWay): Promise<TActionResult> =>
	attempted(`click "${target}" by ${way}`, () => session.withScope((scope) => locateWith(scope, wayLocator(way), target, false).click()));

export const blur = (session: BrowserSession, what: TStepValue): Promise<void> =>
	session.withScope((scope) => locateByDomain(scope, what).evaluate((element) => (element as HTMLElement).blur()));

export const uploadFile = (session: BrowserSession, file: string, selector: TStepValue): Promise<void> =>
	session.withScope((scope) => locateByDomain(scope, selector).setInputFiles(file));

export const resizeWindow = (session: BrowserSession, width: number, height: number): Promise<void> => session.withPage((page) => page.setViewportSize({ width, height }));

/** Blocks, holds without a response, or allows the page's requests to a URL glob, on the page rather than its context, so
 *  other pages of the context keep their requests. A held request is taken and left, as a page reading a site that stopped
 *  responding sees it. */
export const routeRequests = (session: BrowserSession, pattern: string, state: string): Promise<void> =>
	session.withPage(async (page) => {
		if (state === REQUEST_STATE.blocked) await page.route(pattern, (route) => route.abort());
		else if (state === REQUEST_STATE.unanswered) await page.route(pattern, () => undefined);
		else await page.unroute(pattern);
	});

export const setTimeouts = (session: BrowserSession, timeout: number): Promise<void> =>
	session.withPage((page) => {
		page.setDefaultTimeout(timeout);
		page.setDefaultNavigationTimeout(timeout);
	});

/** Accepts each dialog the page opens from now, and keeps what it held through `keep`. */
export const acceptDialogs = (session: BrowserSession, keep: (said: TDialogSays) => void): Promise<void> =>
	session.withPage((page) => {
		page.on("dialog", async (dialog: Dialog) => {
			const said = { defaultValue: dialog.defaultValue(), message: dialog.message(), type: dialog.type() };
			await dialog.accept();
			keep(said);
		});
	});

/** Runs `run` within the element `container` locates, or within the document it shows where it is an iframe. Every caller
 *  of a running instance shares the container scope, so the scope ends however `run` ends. */
export const withinContainer = <T>(session: BrowserSession, container: string, run: () => Promise<T>): Promise<T> =>
	session.withScope(async (scope) => {
		// A step nested in the statement re-runs this context: the same container already holds the scope, so it isn't looked
		// for again, which would search it inside the document the first look entered.
		if (session.inContainerSource === container) return await run();
		// A CSS locator reaches into shadow roots, and a container nested in another is found within it.
		const located = scope.locator(container);
		const outside = { scope: session.inContainer, source: session.inContainerSource };
		session.inContainer = (await located.evaluate((element) => element.tagName)) === "IFRAME" ? located.contentFrame().locator(":root") : located;
		session.inContainerSource = container;
		try {
			return await run();
		} finally {
			session.inContainer = outside.scope;
			session.inContainerSource = outside.source;
		}
	});
