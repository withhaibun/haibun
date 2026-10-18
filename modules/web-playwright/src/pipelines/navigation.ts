/**
 * Navigating the page and waiting for it: a navigation waits for the document, never its `load` event, which a page that
 * keeps loading resources doesn't fire in time, and then gives the page a moment to render.
 */
import type { Page, Response } from "playwright";
import { actionNotOK, jsonArtifact } from "@haibun/core/lib/domains/util.js";
import { OK, type TActionResult } from "@haibun/core/lib/domains/protocol.js";
import type { BrowserSession } from "./browser-session.js";
import { attempted } from "./locate.js";

const DOM_READY_TIMEOUT_MS = 1900;
const RENDER_SETTLE_MS = 200;

/** Waits for the page's document to be parsed, then gives it `RENDER_SETTLE_MS` to render: the grace of a check that a view
 *  stays hidden. A page that isn't parsed in time fails the step. The browser reports the document's state whether or not
 *  it draws the page, so a page in a covered window or a background tab, which draws without frames, is awaited as one in
 *  view. */
export async function waitForLoaded(page: Page): Promise<void> {
	await page.waitForLoadState("domcontentloaded", { timeout: DOM_READY_TIMEOUT_MS });
	await page.waitForTimeout(RENDER_SETTLE_MS);
}

/** Navigates the page as `go` does with the options given, and waits for it as `waitForLoaded` does. */
async function navigate(page: Page, go: (options: { waitUntil: "domcontentloaded" }) => Promise<Response | null>): Promise<Response | null> {
	const response = await go({ waitUntil: "domcontentloaded" });
	await waitForLoaded(page);
	return response;
}

/** Goes to `name`, resolving a relative link against the page's address, as a page's own links are written. A response that
 *  isn't OK fails the step with its status and headers. */
export const goTo = (session: BrowserSession, name: string): Promise<TActionResult> =>
	attempted(`go to ${name}`, async () => {
		const response = await session.withPage(async (page) => {
			const address = URL.parse(name, page.url());
			if (!address) throw new Error(`"${name}" isn't an address, and doesn't resolve against the page's address ${page.url()}`);
			return await navigate(page, (options) => page.goto(address.href, options));
		});
		if (response === null) return actionNotOK(`Did not go to ${name}: the navigation returned without a response`);
		if (response.ok()) return OK;
		const headers = await response.allHeaders().catch((): Record<string, string> => ({}));
		return actionNotOK(`Did not go to ${name}: the response was ${response.status()} ${response.statusText()}`, {
			artifact: jsonArtifact({ statusText: response.statusText(), headers }),
		});
	});

export const reload = (session: BrowserSession): Promise<TActionResult> =>
	attempted("reload the page", () => session.withPage(async (page) => void (await navigate(page, (options) => page.reload(options)))));

export const goBack = (session: BrowserSession): Promise<TActionResult> =>
	attempted("go back", () => session.withPage(async (page) => void (await navigate(page, (options) => page.goBack(options)))));

/** Waits for the page as a navigation does. */
export const settle = (session: BrowserSession): Promise<void> => session.withPage(waitForLoaded);
