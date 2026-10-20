/** What a step reads of the page: its accessibility snapshot, its text, its elements, its address, its cookies, a canvas, and an element's screenshot. */
import { HYPERMEDIA, OK, type TActionResult, type TStepValue } from "@haibun/core/lib/domains/protocol.js";
import { globSource } from "@haibun/core/lib/domains/domains.js";
import { actionNotOK, errorDetail } from "@haibun/core/lib/domains/util.js";
import { DOMAIN_PAGE_TEST_ID } from "../domains/web-playwright.js";
import { locatorDomainOf } from "../derivations/locators.js";
import type { BrowserSession } from "./browser-session.js";
import { locateByDomain } from "./locate.js";

/** How long a canvas has to attach before a step reads it as empty. */
const CANVAS_ATTACH_MS = 1000;
const TIMEOUT_ERROR = "TimeoutError";

/** The page as a snapshot reads it: its address, its title, and its aria snapshot in Playwright's AI mode, which names each
 *  element with the reference `click … by "reference"` takes, with `links` to the steps that act on it. */
export async function readThePage(session: BrowserSession, links: Record<string, { method: string }>) {
	const read = await session.withScope(async (scope) => {
		const page = "page" in scope ? scope.page() : scope;
		return { url: page.url(), title: await page.title(), snapshot: await scope.ariaSnapshot({ mode: "ai" }) };
	});
	return { ...read, [HYPERMEDIA.LINKS]: links };
}

/** Whether an element with the test id is on the page, in its document or within a shadow root. `getByTestId` returns a
 *  locator whether or not an element matches, so the page is searched. */
export async function hasTestId(session: BrowserSession, testId: string): Promise<TActionResult> {
	const found = await session.withPage((page) =>
		page.evaluate((id) => {
			const walk = (root: Document | ShadowRoot): boolean =>
				root.querySelector(`[data-testid="${id}"]`) !== null || [...root.querySelectorAll("*")].some((child) => child.shadowRoot !== null && walk(child.shadowRoot));
			return walk(document);
		}, testId),
	);
	return found ? OK : actionNotOK(`Did not find test id ${testId}`);
}

/** Whether the element a selector finds holds the text, read once, waiting for the element as long as a step waits. */
export async function sees(session: BrowserSession, text: string, selector: string): Promise<TActionResult> {
	const content = await session.withPage((page) => page.textContent(selector));
	if (content === null) return actionNotOK(`Did not find text "${text}" in ${selector}: its text is empty`);
	return content.includes(text) ? OK : actionNotOK(`Did not find text "${text}" in ${selector} (${content.length} characters)`);
}

/** Waits for a target: a test id until its first element attaches to the document, any other locator until its first element is visible. */
export async function waitForTarget(session: BrowserSession, target: TStepValue): Promise<TActionResult> {
	try {
		const state = locatorDomainOf(target) === DOMAIN_PAGE_TEST_ID ? "attached" : "visible";
		await session.withScope((scope) => locateByDomain(scope, target).first().waitFor({ state }));
		return OK;
	} catch (e) {
		return actionNotOK(`Did not find ${String(target.value)}: ${errorDetail(e)}`);
	}
}

/** Waits until a target is gone: its first element is detached from the document or hidden. */
export async function waitUntilGone(session: BrowserSession, target: TStepValue): Promise<TActionResult> {
	try {
		await session.withScope((scope) => locateByDomain(scope, target).first().waitFor({ state: "hidden" }));
		return OK;
	} catch (e) {
		return actionNotOK(`${String(target.value)} is still shown: ${errorDetail(e)}`);
	}
}

/** Waits until the page's address is `name`. */
export async function isOnPage(session: BrowserSession, name: string): Promise<TActionResult> {
	const address = await session.withPage(async (page) => {
		await page.waitForURL(name);
		return page.url();
	});
	return address === name ? OK : actionNotOK(`expected ${name} but on ${address}`);
}

/** Whether the feature's context holds the cookie with the value. */
export async function cookieIs(session: BrowserSession, featureNum: number, name: string, value: string): Promise<TActionResult> {
	const context = session.pages?.context(featureNum);
	const cookies = context === undefined ? [] : await context.cookies();
	return cookies.some((cookie) => cookie.name === name && cookie.value === value)
		? OK
		: actionNotOK(`did not find cookie ${name} with value ${value} from ${JSON.stringify(cookies)}`);
}

/** The page's address. */
export const pageAddress = (session: BrowserSession): Promise<string> => session.withPage((page) => page.url());

/** A parameter of the page's address query, or null where the address lacks it. */
export const queryParameter = async (session: BrowserSession, name: string): Promise<string | null> => new URL(await pageAddress(session)).searchParams.get(name);

/** Waits for an address that matches the glob: the browser reports the address of each navigation, a change within the
 *  document included, so a page that draws without frames is awaited as one in view. */
export async function waitForAddress(session: BrowserSession, pattern: string): Promise<TActionResult> {
	const page = await session.page();
	try {
		await page.waitForURL(new RegExp(globSource(pattern), "s"), { waitUntil: "commit" });
		return OK;
	} catch (e) {
		return actionNotOK(`the page's address didn't match "${pattern}": it is ${page.url()} (${errorDetail(e)})`);
	}
}

/** Whether a canvas is blank: one that doesn't attach in time, or lacks a 2D context, is blank. */
export async function canvasIsEmpty(session: BrowserSession, what: string): Promise<TActionResult> {
	const drawn = await session.withPage(async (page) => {
		const locator = page.locator(what);
		const attached = await locator.waitFor({ state: "attached", timeout: CANVAS_ATTACH_MS }).then(
			() => true,
			(error: unknown) => {
				if (error instanceof Error && error.name === TIMEOUT_ERROR) return false;
				throw error;
			},
		);
		if (!attached) return false;
		return await locator.evaluate((canvas: HTMLCanvasElement) => {
			const context = canvas.getContext("2d");
			return context !== null && new Uint32Array(context.getImageData(0, 0, canvas.width, canvas.height).data.buffer).some((color) => color !== 0);
		});
	});
	return drawn ? actionNotOK(`canvas ${what} is not empty`) : OK;
}

/** Saves a screenshot of the one element `what` locates to `where`. */
export async function screenshotOf(session: BrowserSession, what: TStepValue, where: string): Promise<TActionResult> {
	try {
		await session.withScope(async (scope) => {
			const locator = locateByDomain(scope, what);
			const count = await locator.count();
			if (count !== 1) throw new Error(`${String(locator)} locates ${count} elements of ${String(what.value)}, and a screenshot takes exactly one`);
			await locator.screenshot({ path: where });
		});
		return OK;
	} catch (e) {
		return actionNotOK(`the screenshot of ${String(what.value)} wasn't saved to ${where}: ${errorDetail(e)}`);
	}
}

/** The page's markup. */
export const pageContents = (session: BrowserSession): Promise<string> => session.withPage((page) => page.content());

/** The text of an element: its text, trimmed, or a form field's value where the element lacks a text node, as a void
 *  element or a custom element without light-DOM text does. An empty element's text is empty rather than absent. */
export const textOf = (session: BrowserSession, element: TStepValue): Promise<string> =>
	session.withPage(async (page) => {
		const locator = locateByDomain(page, element);
		const content = await locator.textContent();
		return content === null ? await locator.inputValue() : content.trim();
	});
