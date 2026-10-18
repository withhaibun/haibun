/** The locator domain of a page target, which selects the Playwright `getBy` method that finds it. */
import { domainParts } from "@haibun/core/lib/domains/domains.js";
import type { TStepValue } from "@haibun/core/lib/domains/protocol.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import {
	DOMAIN_PAGE_ALT_TEXT,
	DOMAIN_PAGE_LABEL,
	DOMAIN_PAGE_LOCATOR,
	DOMAIN_PAGE_PLACEHOLDER,
	DOMAIN_PAGE_ROLE,
	DOMAIN_PAGE_TEST_ID,
	DOMAIN_PAGE_TEXT,
	DOMAIN_PAGE_TITLE,
} from "../domains/web-playwright.js";

/** The specific locator domains, in the order a union of them selects one. */
const SPECIFIC_LOCATORS = [DOMAIN_PAGE_TEST_ID, DOMAIN_PAGE_LABEL, DOMAIN_PAGE_PLACEHOLDER, DOMAIN_PAGE_ROLE, DOMAIN_PAGE_TITLE, DOMAIN_PAGE_ALT_TEXT, DOMAIN_PAGE_LOCATOR];

/** Selects the locator domain for a value whose domain is a union of locator domains: page text where the union contains
 *  it, since a literal is text the page shows, and otherwise the first specific locator domain the union contains. */
export function pickLocatorDomain(parts: string[]): string {
	if (parts.includes(DOMAIN_PAGE_TEXT)) return DOMAIN_PAGE_TEXT;
	const specific = SPECIFIC_LOCATORS.find((domain) => parts.includes(domain));
	return specific === undefined ? itemAt(parts, 0) : specific;
}

/** The locator domain of a page target: its own domain when that is a single locator domain, and page text for a literal,
 *  whose domain is the whole page-target union. */
export const locatorDomainOf = (target: TStepValue): string => {
	const parts = domainParts(target.domain);
	return parts.length === 1 ? itemAt(parts, 0) : pickLocatorDomain(parts);
};
