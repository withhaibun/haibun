/** Locating an element where a step finds it, and running an action that states what it attempted where it fails. */
import type { Locator } from "playwright";
import { actionNotOK, errorDetail } from "@haibun/core/lib/domains/util.js";
import { OK, type TActionResult, type TStepValue } from "@haibun/core/lib/domains/protocol.js";
import type { TPageLocator } from "../domains/web-playwright.js";
import { locatorOf } from "../derivations/locators.js";
import type { TPageScope } from "./browser-session.js";

/** The Playwright locator of a value, from the method a row of `PAGE_LOCATORS` names and the prefix it takes, matching the
 *  element's whole text where `exact` holds. */
export function locateWith(scope: TPageScope, { method, prefix }: TPageLocator, value: string, exact: boolean): Locator {
	const locate = scope[method].bind(scope) as (argument: string, options?: { exact: boolean }) => Locator;
	return exact ? locate(`${prefix}${value}`, { exact }) : locate(`${prefix}${value}`);
}

/** The Playwright locator of a page target, from the row of `PAGE_LOCATORS` its domain selects. */
export function locateByDomain(scope: TPageScope, target: TStepValue): Locator {
	const row = locatorOf(target);
	return locateWith(scope, row, String(target.value), row.exact);
}

/** Runs an action on the page, and where it throws, states what it attempted before the browser's reason, as `Did not
 *  click "Knock": …`, so a reader of the failure sees the action and the reason together. An action that returns its own
 *  result returns with it. */
export async function attempted(what: string, act: () => Promise<TActionResult | void>): Promise<TActionResult> {
	try {
		const result = await act();
		return result === undefined ? OK : result;
	} catch (e) {
		return actionNotOK(`Did not ${what}: ${errorDetail(e)}`);
	}
}
