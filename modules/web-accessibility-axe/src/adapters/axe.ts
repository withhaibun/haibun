/** axe-core run in a page: its source evaluated in the page, then a run over the page's document. */
import { readFileSync } from "fs";
import { createRequire } from "module";
import type { Page } from "playwright";
import type { AxeResults } from "axe-core";
import type { TAxe } from "../ports.js";

declare global {
	interface Window {
		/** axe-core, once its source is evaluated in the page. */
		axe: typeof import("axe-core");
	}
}

/** axe-core's source, as the page evaluates it. */
const AXE_SOURCE: string = readFileSync(createRequire(import.meta.url).resolve("axe-core"), "utf8");

/** Evaluates axe-core's source in the page and returns its run over the page's document. */
export const axeBrowser: TAxe = {
	async results(page: Page): Promise<AxeResults> {
		await page.evaluate((axe: string) => window.eval(axe), AXE_SOURCE);
		return page.evaluate(() => window.axe.run(window.document));
	},
};
