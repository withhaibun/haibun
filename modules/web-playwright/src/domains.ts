import { TDomainDefinition, TStepValue } from "@haibun/core/lib/defs.js";
import { DOMAIN_STRING } from "@haibun/core/lib/domain-types.js";

export const DOMAIN_PAGE_LOCATOR = 'page-locator';

export const WebPlaywrightDomains: TDomainDefinition[] = [
	{
		selectors: [DOMAIN_PAGE_LOCATOR],
		coerce: (proto: TStepValue) => String(proto.value)
	},
	{
		selectors: [DOMAIN_PAGE_LOCATOR, DOMAIN_STRING],
		coerce: (proto: TStepValue) => String(proto.value)
	}
]
