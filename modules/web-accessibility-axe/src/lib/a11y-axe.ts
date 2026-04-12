import { readFileSync } from "fs";
import { createRequire } from "module";
import { Page } from "playwright";
import { Spec, ElementContext, RunOptions, AxeResults } from "axe-core";
import { ConfigOptions } from "./axe-types.js";

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

export const injectAxe = async (page: Page): Promise<void> => {
	await page.evaluate((axe: string) => window.eval(axe), axe);
};

export const configureAxe = async (page: Page, configurationOptions: ConfigOptions = {}): Promise<void> => {
	await page.evaluate(
		// biome-ignore lint/suspicious/noExplicitAny: window property
		(configOptions: Spec) => (window as any).configure(configOptions),
		configurationOptions as Spec,
	);
};

export const getAxeResults = (page: Page, context?: ElementContext, options?: RunOptions): Promise<AxeResults> => {
	return page.evaluate(
		([context, options]) => (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<AxeResults> } }).axe.run(context || window.document, options),
		[/*context,*/ options],
	) as Promise<AxeResults>;
};
