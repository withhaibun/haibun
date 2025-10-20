import { TDomainDefinition, TWorld } from "./defs.js";

// Core types that replace the domain system, used in vars and modules like filesystem, web
export const WEB_PAGE = 'webpage';
export const DOMAIN_STATEMENT = 'statement';

// Type constants
export const DOMAIN_STRING = 'string';
export const DOMAIN_NUMBER = 'number';
export const DOMAIN_JSON = 'json';

export const BASE_TYPES = [DOMAIN_STRING, DOMAIN_NUMBER, WEB_PAGE, DOMAIN_STATEMENT, DOMAIN_JSON];

export const registerDomains = (world: TWorld, results: TDomainDefinition[][]) => {
	for (const stepperWithDomains of results) {
		for (const definition of stepperWithDomains) {
			const domainKey = asDomainKey(definition.selectors);

			if (world.domains[domainKey]) {
				throw Error(`Domain "${domainKey}" is already registered}`);
			}

			world.domains[domainKey] = { coerce: definition.coerce };
		}
	}
}

export const asDomainKey = (domains: string[]) => domains.sort().join(' | ');
