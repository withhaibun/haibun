/** The row of `PAGE_LOCATORS` a page target's domain selects, which names the Playwright method that finds it. */
import { DOMAIN_STRING, domainParts } from "@haibun/core/lib/domains/domains.js";
import type { TStepValue } from "@haibun/core/lib/domains/protocol.js";
import {
	DOMAIN_PAGE_TARGET,
	DOMAIN_PAGE_TEXT,
	isDomainLocator,
	PAGE_LOCATORS,
	type TDomainLocator,
	type TFindWay,
	type TWayLocator,
	WAY_LOCATORS,
} from "../domains/web-playwright.js";

/** Selects the first row of `PAGE_LOCATORS` whose domain the parts of a domain key contain. Page text comes first, since a
 *  literal's domain is the whole page-target union and a literal is text the page shows. */
export function pickLocator(parts: string[]): TDomainLocator {
	const row = PAGE_LOCATORS.filter(isDomainLocator).find(({ domain }) => parts.includes(domain));
	if (row === undefined) throw new Error(`${parts.join(", ")} doesn't contain a locator domain. A page target takes a value of ${DOMAIN_PAGE_TARGET}.`);
	return row;
}

/** The row of `PAGE_LOCATORS` that locates a page target. A value of a string variable is page text, as a literal is. */
export const locatorOf = (target: TStepValue): TDomainLocator => pickLocator(target.domain === DOMAIN_STRING ? [DOMAIN_PAGE_TEXT] : domainParts(target.domain));

/** The row of `PAGE_LOCATORS` a click by way names. */
export function wayLocator(way: TFindWay): TWayLocator {
	const row = WAY_LOCATORS.find((locator) => locator.way === way);
	if (row === undefined) throw new Error(`${way} isn't a way to find what a click presses. A click by way takes one of ${WAY_LOCATORS.map((locator) => locator.way).join(", ")}.`);
	return row;
}
