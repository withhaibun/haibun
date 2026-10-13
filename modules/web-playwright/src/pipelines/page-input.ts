/** What a step does to the page: keys, text, fields, clicks, uploads, the window's size, the page's requests, its timeouts and its dialogs. */
import type { Dialog, Locator, Page } from "playwright";
import type { TActionResult, TStepValue } from "@haibun/core/schema/protocol.js";
import { REQUEST_STATE, type TFindWay } from "../domains/web-playwright.js";
import type { BrowserSession, TPageScope } from "./browser-session.js";
import { attempted, locateByDomain } from "./locate.js";

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
			await locator.selectOption({ value: what }).catch(() => locator.selectOption({ label: what }));
		}),
	);

export const selectOption = (session: BrowserSession, option: string, field: TStepValue): Promise<TActionResult> =>
	attempted(`select "${option}" for ${String(field.value)}`, () => session.withScope(async (scope) => void (await locateByDomain(scope, field).selectOption({ label: option }))));

/** Clicks a target; a forced click doesn't wait for the target to be visible and take the click. */
export const click = (session: BrowserSession, target: TStepValue, force: boolean): Promise<TActionResult> =>
	attempted(`click ${String(target.value)}`, () => session.withScope((scope) => locateByDomain(scope, target).click({ force })));

/** The locator of each way to find what a click presses. */
const FINDS: Record<TFindWay, (scope: TPageScope, target: string) => Locator> = {
	"alt text": (scope, target) => scope.getByAltText(target),
	"test id": (scope, target) => scope.getByTestId(target),
	placeholder: (scope, target) => scope.getByPlaceholder(target),
	role: (scope, target) => scope.getByRole(target as Parameters<Page["getByRole"]>[0]),
	label: (scope, target) => scope.getByLabel(target),
	title: (scope, target) => scope.getByTitle(target),
	text: (scope, target) => scope.getByText(target),
	reference: (scope, target) => scope.locator(`aria-ref=${target}`),
};

export const clickBy = (session: BrowserSession, target: string, way: TFindWay): Promise<TActionResult> =>
	attempted(`click "${target}" by ${way}`, () => session.withScope((scope) => FINDS[way](scope, target).click()));

export const blur = (session: BrowserSession, what: TStepValue): Promise<void> =>
	session.withScope((scope) => locateByDomain(scope, what).evaluate((element) => (element as HTMLElement).blur()));

export const uploadFile = (session: BrowserSession, file: string, selector: TStepValue): Promise<void> =>
	session.withScope((scope) => locateByDomain(scope, selector).setInputFiles(file));

export const resizeWindow = (session: BrowserSession, width: number, height: number): Promise<void> => session.withPage((page) => page.setViewportSize({ width, height }));

/** Sizes the page's viewport to the screen's available area. */
export const resizeToScreen = (session: BrowserSession): Promise<void> =>
	session.withPage(async (page) => page.setViewportSize(await page.evaluate(() => ({ width: window.screen.availWidth, height: window.screen.availHeight }))));

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
export const withinContainer = (session: BrowserSession, container: string, run: () => Promise<TActionResult>): Promise<TActionResult> =>
	session.withScope(async (scope) => {
		// A CSS locator reaches into shadow roots, and a container nested in another is found within it.
		const located = scope.locator(container);
		session.inContainer = (await located.evaluate((element) => element.tagName)) === "IFRAME" ? located.contentFrame().locator(":root") : located;
		try {
			return await run();
		} finally {
			session.inContainer = undefined;
		}
	});
