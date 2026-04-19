import { z } from "zod";
import { TDomainDefinition } from "@haibun/core/lib/resources.js";
import { DOMAIN_STRING } from "@haibun/core/lib/domains.js";

export const DOMAIN_PAGE_LOCATOR = "page-locator";
export const DOMAIN_PAGE_TEST_ID = "page-test-id";
export const DOMAIN_PAGE_LABEL = "page-label";
export const DOMAIN_PAGE_PLACEHOLDER = "page-placeholder";
export const DOMAIN_PAGE_ROLE = "page-role";
export const DOMAIN_PAGE_TITLE = "page-title";
export const DOMAIN_PAGE_ALT_TEXT = "page-alt-text";

const locatorSchema = z.string().min(1, "locator cannot be empty");

export const WebPlaywrightDomains: TDomainDefinition[] = [
	{
		selectors: [DOMAIN_PAGE_LOCATOR],
		schema: locatorSchema,
		description: "Playwright selector such as css= or text=",
	},
	{
		selectors: [DOMAIN_PAGE_LOCATOR, DOMAIN_STRING],
		schema: locatorSchema,
		description: "Locator that also satisfies string semantics.",
	},
	{
		selectors: [DOMAIN_PAGE_TEST_ID],
		schema: locatorSchema,
		description: "Playwright getByTestId selector (data-testid attribute)",
	},
	{
		selectors: [DOMAIN_PAGE_LABEL],
		schema: locatorSchema,
		description: "Playwright getByLabel selector (label text)",
	},
	{
		selectors: [DOMAIN_PAGE_PLACEHOLDER],
		schema: locatorSchema,
		description: "Playwright getByPlaceholder selector (placeholder text)",
	},
	{
		selectors: [DOMAIN_PAGE_ROLE],
		schema: locatorSchema,
		description: "Playwright getByRole selector (ARIA role)",
	},
	{
		selectors: [DOMAIN_PAGE_TITLE],
		schema: locatorSchema,
		description: "Playwright getByTitle selector (title attribute)",
	},
	{
		selectors: [DOMAIN_PAGE_ALT_TEXT],
		schema: locatorSchema,
		description: "Playwright getByAltText selector (alt attribute)",
	},
];
