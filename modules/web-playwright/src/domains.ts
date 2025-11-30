import { z } from 'zod';
import { TDomainDefinition } from "@haibun/core/lib/defs.js";
import { DOMAIN_STRING } from "@haibun/core/lib/domain-types.js";

export const DOMAIN_PAGE_LOCATOR = 'page-locator';

const locatorSchema = z.string().min(1, 'locator cannot be empty');

export const WebPlaywrightDomains: TDomainDefinition[] = [
	{
		selectors: [DOMAIN_PAGE_LOCATOR],
		schema: locatorSchema,
		description: 'Playwright selector such as css= or text=',
	},
	{
		selectors: [DOMAIN_PAGE_LOCATOR, DOMAIN_STRING],
		schema: locatorSchema,
		description: 'Locator that also satisfies string semantics.',
	}
]
