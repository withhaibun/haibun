/** A request made with `fetch` inside the page, so it carries the page's own cookies, and its response as the page received it. */
import type { ConsoleMessage, Page } from "playwright";
import type { TCapturedResponse, TJsonResponse } from "../domains/web-playwright.js";
import type { TPageFetch } from "../ports.js";

export const fetchInPage: TPageFetch = async (page: Page, request) => {
	const said: string[] = [];
	const onConsole = (message: ConsoleMessage) => void said.push(`[${message.type()}] ${message.text()}`);
	page.on("console", onConsole);
	try {
		return await page.evaluate(async ({ endpoint, method, headers, postData }) => {
			const response = await fetch(endpoint, { method, headers, ...(postData === undefined ? {} : { body: postData }) });
			// A body is read once, as its text, and read again as JSON where it is JSON.
			const text = await response.text();
			let json: TJsonResponse | undefined;
			try {
				json = JSON.parse(text) as TJsonResponse;
			} catch {
				// A body that isn't JSON is its text alone.
			}
			const captured: TCapturedResponse = {
				status: response.status,
				statusText: response.statusText,
				headers: Object.fromEntries(response.headers.entries()),
				url: response.url,
				text,
				...(json === undefined ? {} : { json }),
			};
			return captured;
		}, request);
	} catch (e) {
		throw new Error(`the page's fetch of ${request.method} ${request.endpoint} failed: ${e instanceof Error ? e.message : String(e)}. The page's console: ${said.join("; ")}`);
	} finally {
		page.off("console", onConsole);
	}
};
