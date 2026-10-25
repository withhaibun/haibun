/**
 * A following column in a real browser, over rows a test appends: the rail states the column's end as rows arrive, also
 * where rows that don't take room follow its last row; a row a reader presses stays under the pointer while rows arrive,
 * so the press's click reaches it; and the column leaves the document while its virtualizer lays out rows without an
 * error. Each needs a layout, which only a browser computes.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RAIL_POSITION_MAX } from "../derivations/rail.js";
import { builtEntry, openTestPage, type TTestPage } from "../../test/test-page.js";
import { VIRTUAL_COLUMN_PAGE } from "../../test/virtual-column-routes.js";

const ENTRY_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "virtual-column-page-entry.ts");
/** The page: the column fills a box of a fixed size, as a column fills its pane. */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="${VIRTUAL_COLUMN_PAGE.entry}"></script></head>
<body style="margin:0;display:flex;flex-direction:column;width:600px;height:400px"></body></html>`;
/** How long the page has to start, and the column to show the rows a step appends. */
const SHOWS_MS = 10_000;
/** How long a test of a few appends has, each within SHOWS_MS. */
const TEST_MS = 4 * SHOWS_MS;

let opened: TTestPage;

beforeAll(async () => {
	const entry = await builtEntry(ENTRY_PATH);
	opened = await openTestPage(
		(url, res) => {
			if (url === "/") res.writeHead(200, { "Content-Type": "text/html" }).end(PAGE);
			else if (url === VIRTUAL_COLUMN_PAGE.entry) res.writeHead(200, { "Content-Type": "application/javascript" }).end(entry);
			else return false;
			return true;
		},
		{ viewport: { width: 600, height: 400 }, deviceScaleFactor: 1 },
	);
	await opened.page.goto(opened.url);
	await opened.page.waitForFunction((call) => call in globalThis, VIRTUAL_COLUMN_PAGE.appendRows, { timeout: SHOWS_MS });
}, 60_000);

afterAll(() => opened?.close());

/** Appends rows to the column, each true where it shows content. */
const append = (shows: boolean[]) =>
	opened.page.evaluate(({ call, more }) => (globalThis as unknown as Record<string, (rows: boolean[]) => void>)[call]?.(more), {
		call: VIRTUAL_COLUMN_PAGE.appendRows,
		more: shows,
	});
/** Waits until the rail states the position `at`, which it states to assistive technology. */
const railAt = (at: number) =>
	opened.page.waitForFunction(
		(position) => document.querySelector("shu-scrollbar")?.shadowRoot?.querySelector('[role="scrollbar"]')?.getAttribute("aria-valuenow") === String(position),
		at,
		{ timeout: SHOWS_MS },
	);
/** Appends rows to the column and waits until it has taken them in: the virtualizer reports the items it took as a changed range,
 *  then lays them out, then the column's update and the frames after them draw what the column did with them. The virtualizer
 *  creates its layout's promise when it is read and resolves it only by a layout under way, so it is read as the range is
 *  reported, as the column reads it; read after that layout ends, the promise doesn't settle. */
const appendTakenIn = (shows: boolean[]) =>
	opened.page.evaluate(
		async ({ call, more }) => {
			const virtualizer = document.querySelector("lit-virtualizer") as (Element & { layoutComplete: Promise<void> }) | null;
			const column = document.querySelector("shu-virtual-column") as (Element & { updateComplete: Promise<boolean> }) | null;
			if (virtualizer === null || column === null) throw new Error("the page doesn't hold a column with its virtualizer");
			const laidOut = new Promise<void>((done) => virtualizer.addEventListener("rangeChanged", () => done(virtualizer.layoutComplete), { once: true }));
			(globalThis as unknown as Record<string, (rows: boolean[]) => void>)[call]?.(more);
			await laidOut;
			await column.updateComplete;
			await new Promise((drawn) => requestAnimationFrame(() => requestAnimationFrame(drawn)));
		},
		{ call: VIRTUAL_COLUMN_PAGE.appendRows, more: shows },
	);

test("states its end on the rail as rows that show content arrive, and as rows that don't take room arrive after them", { timeout: TEST_MS }, async () => {
	await append(Array.from({ length: 100 }, () => true));
	await railAt(RAIL_POSITION_MAX);
	await append([true]);
	await railAt(RAIL_POSITION_MAX);
	await append([false, false, false]);
	await railAt(RAIL_POSITION_MAX);
	expect(opened.pageErrors).toEqual([]);
});

test("keeps a pressed row under the pointer while rows arrive, so the press's click reaches the row", { timeout: TEST_MS }, async () => {
	await append(Array.from({ length: 20 }, () => true));
	await railAt(RAIL_POSITION_MAX);
	const pressed = await opened.page.evaluate(() => {
		const rows = [...document.querySelectorAll("lit-virtualizer > div")].filter((row) => row.textContent !== "");
		const row = rows[rows.length - 2];
		const box = row?.getBoundingClientRect();
		return row === undefined || box === undefined ? undefined : { text: String(row.textContent), x: box.left + box.width / 2, y: box.top + box.height / 2 };
	});
	if (pressed === undefined) throw new Error(`the column doesn't render a row to press. ${opened.failures()}`);
	await opened.page.mouse.move(pressed.x, pressed.y);
	await opened.page.mouse.down();
	await appendTakenIn(Array.from({ length: 5 }, () => true));
	await opened.page.mouse.up();
	expect(await opened.page.evaluate((key) => (globalThis as unknown as Record<string, string[]>)[key], VIRTUAL_COLUMN_PAGE.clicked)).toEqual([pressed.text]);
});

test("leaves the document while its virtualizer lays out rows it took, without an error on the page", { timeout: TEST_MS }, async () => {
	const returned = opened.page.evaluate(async () => {
		const column = document.querySelector("shu-virtual-column");
		if (column === null) throw new Error("the page doesn't hold a column");
		// The column's own listener reads the virtualizer's pending layout first, and this one takes the column out before it settles.
		await new Promise((left) => column.querySelector("lit-virtualizer")?.addEventListener("rangeChanged", () => left(column.remove()), { once: true }));
		await new Promise((drawn) => requestAnimationFrame(() => requestAnimationFrame(drawn)));
		document.body.append(column);
	});
	await append([true]);
	await returned;
	expect(opened.pageErrors).toEqual([]);
});
