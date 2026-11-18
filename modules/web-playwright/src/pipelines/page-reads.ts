/** What a step reads of the page through the browser session: its accessibility snapshot, a canvas, and an element's
 *  screenshot. What a page shows, holds and waits for is read through the locator domains' and the `browser-page`
 *  domain's properties, over the port in `browser-pages.ts`. */
import { HYPERMEDIA, OK, type TActionResult, type TStepValue } from "@haibun/core/lib/domains/protocol.js";
import { actionNotOK, errorDetail } from "@haibun/core/lib/domains/util.js";
import type { BrowserSession } from "./browser-session.js";
import { locateByDomain } from "./locate.js";
import { timedOut } from "./browser-pages.js";

/** How long a canvas has to attach before a step reads it as empty. */
const CANVAS_ATTACH_MS = 1000;

/** The page as a snapshot reads it: its address, its title, and its aria snapshot in Playwright's AI mode, which names each
 *  element with the reference `click … by "reference"` takes, with `links` to the steps that act on it. */
export async function readThePage(session: BrowserSession, links: Record<string, { method: string }>) {
	const read = await session.withScope(async (scope) => {
		const page = "page" in scope ? scope.page() : scope;
		return { url: page.url(), title: await page.title(), snapshot: await scope.ariaSnapshot({ mode: "ai" }) };
	});
	return { ...read, [HYPERMEDIA.LINKS]: links };
}

/** Whether a canvas is blank: one that doesn't attach in time, or lacks a 2D context, is blank. */
export async function canvasIsEmpty(session: BrowserSession, what: string): Promise<TActionResult> {
	const drawn = await session.withPage(async (page) => {
		const locator = page.locator(what);
		const attached = await locator.waitFor({ state: "attached", timeout: CANVAS_ATTACH_MS }).then(
			() => true,
			(error: unknown) => {
				if (timedOut(error)) return false;
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
