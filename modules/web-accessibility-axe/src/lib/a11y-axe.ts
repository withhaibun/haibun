import { readFileSync } from "fs";
import { createRequire } from "module";
import { Page } from "playwright";
import type { AxeResults } from "axe-core";

declare global {
	interface Window {
		/** axe-core, once `injectAxe` has evaluated its source in the page. */
		axe: typeof import("axe-core");
	}
}

const require = createRequire(import.meta.url);

function getModulePath() {
	const modulePath = require.resolve("axe-core");
	return modulePath;
}
const axeLoc = await getModulePath();
const axe: string = readFileSync(axeLoc, "utf8");

export async function getAxeBrowserResult(page: Page) {
	await injectAxe(page);
	const result = await getAxeResults(page);
	return result;
}

export function evalSeverity(axeResults: AxeResults, acceptable: { serious: number; moderate: number }) {
	const serious = axeResults.violations.filter((violation) => violation.impact === "serious");
	const moderate = axeResults.violations.filter((violation) => violation.impact === "moderate");

	return {
		ok: serious.length <= acceptable.serious && moderate.length <= acceptable.moderate,
		acceptable,
		found: {
			serious: serious.length,
			moderate: moderate.length,
		},
	};
}

const injectAxe = async (page: Page): Promise<void> => {
	await page.evaluate((axe: string) => window.eval(axe), axe);
};

const getAxeResults = (page: Page): Promise<AxeResults> => page.evaluate(() => window.axe.run(window.document));
