/**
 * A file a page opens in a tab of its own, in a real browser driven as a test drives it: the page's IndexedDB transactions in
 * flight while the tab opens commit. A tab made in the page's process aborted them, which only a browser shows.
 */
import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import { afterAll, beforeAll, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { builtEntry, openTestPage, type TTestPage } from "../../test/test-page.js";
import { FILE_TAB_PAGE } from "../../test/file-tab-routes.js";

const ENTRY_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "file-tab-page-entry.ts");
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="${FILE_TAB_PAGE.entry}"></script></head><body></body></html>`;
/** How many tabs the test opens. A tab made in the page's process aborted one of the page's transactions at most opens. */
const OPENS = 10;
/** How long the page has to start, and a tab to open. */
const OPENS_MS = 10_000;

let opened: TTestPage;

beforeAll(async () => {
	const entry = await builtEntry(ENTRY_PATH);
	opened = await openTestPage(
		(url, res) => {
			if (url === "/") res.writeHead(200, { "Content-Type": "text/html" }).end(PAGE);
			else if (url === FILE_TAB_PAGE.entry) res.writeHead(200, { "Content-Type": MEDIA_TYPE.javascript }).end(entry);
			else return false;
			return true;
		},
		{ viewport: { width: 600, height: 400 }, deviceScaleFactor: 1 },
	);
	await opened.page.goto(opened.url);
	await opened.page.waitForFunction((key) => Number(Reflect.get(globalThis, key)) > 0, FILE_TAB_PAGE.reads, { timeout: OPENS_MS });
}, 60_000);

afterAll(() => opened?.close());

/** How many writes the page has completed. */
const reads = () => opened.page.evaluate((key) => Number(Reflect.get(globalThis, key)), FILE_TAB_PAGE.reads);

test("opens a file in a tab of its own while the page's transactions commit", { timeout: OPENS * OPENS_MS }, async () => {
	for (let n = 0; n < OPENS; n++) {
		const tab = opened.page.waitForEvent("popup", { timeout: OPENS_MS });
		await opened.page.click(`#${FILE_TAB_PAGE.open}`);
		await tab;
	}
	const before = await reads();
	await opened.page.waitForFunction(({ key, at }) => Number(Reflect.get(globalThis, key)) > at, { key: FILE_TAB_PAGE.reads, at: before }, { timeout: OPENS_MS });
	expect(await opened.page.evaluate((key) => Reflect.get(globalThis, key) as string[], FILE_TAB_PAGE.failures)).toEqual([]);
	expect(opened.pageErrors).toEqual([]);
});
