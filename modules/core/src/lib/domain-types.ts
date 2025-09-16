import { TStepValueValue, TWorld } from "./defs.js";
import { findFeatureStepsFromStatement } from "./util/resolveAndExecuteStatement.js";

// Core types that replace the domain system, used in vars and modules like filesystem, web
export const WEB_PAGE = 'webpage';
export const WEB_CONTROL = 'webcontrol';
export const DOMAIN_STATEMENT = 'statement';

// Type constants
export const DOMAIN_STRING = 'string';
export const DOMAIN_NUMBER = 'number';
export const DOMAIN_PAGE_LOCATOR = 'page-locator';
export const DOMAIN_JSON = 'json';

export const BASE_TYPES = [DOMAIN_STRING, DOMAIN_NUMBER, WEB_CONTROL, WEB_PAGE, DOMAIN_STATEMENT, DOMAIN_PAGE_LOCATOR, DOMAIN_JSON];

// Core domain registry factory. Returns coercion functions for built-in domains.
export const getCoreDomains = (world: TWorld) => ({
	[DOMAIN_STRING]: { coerce: (label: string) => label },
	[DOMAIN_NUMBER]: {
		coerce: (label: string) => {
			const n = Number(label);
			if (isNaN(n)) throw new Error(`invalid number '${label}'`);
			return n;
		}
	},
	[DOMAIN_PAGE_LOCATOR]: { coerce: (label: string) => label },
	[DOMAIN_JSON]: {
		coerce: (label: string) => {
			try {
				JSON.parse(label); return label;
			}
			catch { throw new Error(`invalid json '${label}'`); }
		}
	},
	[DOMAIN_STATEMENT]: {
		coerce: (label: string, steppers) => {
			if (label === undefined) {
				throw Error(`missing label for statement placeholder ${label}`);
			}
			return <TStepValueValue><unknown>findFeatureStepsFromStatement(label, steppers, world, `<${DOMAIN_STATEMENT}.${label}>`);
		}
	}
});
