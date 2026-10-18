/** Locating an element where a step finds it, and running an action that states what it attempted where it fails. */
import type { Locator, Page } from "playwright";
import { DOMAIN_STRING } from "@haibun/core/lib/domains/domains.js";
import { actionNotOK, errorDetail } from "@haibun/core/lib/domains/util.js";
import { OK, type TActionResult, type TStepValue } from "@haibun/core/lib/domains/protocol.js";
import {
	DOMAIN_PAGE_ALT_TEXT,
	DOMAIN_PAGE_LABEL,
	DOMAIN_PAGE_PLACEHOLDER,
	DOMAIN_PAGE_ROLE,
	DOMAIN_PAGE_TEST_ID,
	DOMAIN_PAGE_TEXT,
	DOMAIN_PAGE_TITLE,
} from "../domains/web-playwright.js";
import { locatorDomainOf } from "../derivations/locators.js";
import type { TPageScope } from "./browser-session.js";

/** The Playwright locator of a page target, from the `getBy` method its locator domain selects; a CSS or XPath selector otherwise. */
export function locateByDomain(scope: TPageScope, target: TStepValue): Locator {
	const value = String(target.value);
	switch (locatorDomainOf(target)) {
		case DOMAIN_STRING:
		case DOMAIN_PAGE_TEXT:
			return scope.getByText(value, { exact: true });
		case DOMAIN_PAGE_TEST_ID:
			return scope.getByTestId(value);
		case DOMAIN_PAGE_LABEL:
			return scope.getByLabel(value);
		case DOMAIN_PAGE_PLACEHOLDER:
			return scope.getByPlaceholder(value);
		case DOMAIN_PAGE_ROLE:
			return scope.getByRole(value as Parameters<Page["getByRole"]>[0]);
		case DOMAIN_PAGE_TITLE:
			return scope.getByTitle(value);
		case DOMAIN_PAGE_ALT_TEXT:
			return scope.getByAltText(value);
		default:
			return scope.locator(value);
	}
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
