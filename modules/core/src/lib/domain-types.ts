import { TStepValueValue, TWorld } from "./defs.js";
import { findFeatureStepsFromStatement } from "./util/resolveAndExecuteStatement.js";

// Core types that replace the domain system, used in vars and modules like filesystem, web
export const WEB_PAGE = 'webpage';
export const DOMAIN_STATEMENT = 'statement';

// Type constants
export const DOMAIN_STRING = 'string';
export const DOMAIN_NUMBER = 'number';
export const DOMAIN_JSON = 'json';

export const BASE_TYPES = [DOMAIN_STRING, DOMAIN_NUMBER, WEB_PAGE, DOMAIN_STATEMENT, DOMAIN_JSON];

// Core domain registry factory. Returns coercion functions for built-in domains.
export const getCoreDomains = (world: TWorld) => ({
	[DOMAIN_STRING]: {
		coerce: (label: TStepValueValue) => String(label),
	},
	[DOMAIN_NUMBER]: {
		coerce: (label: TStepValueValue) => {
			if (typeof label !== 'string' && typeof label !== 'number') throw new Error(`invalid number '${String(label)}'`);
			const n = Number(label);
			if (isNaN(n)) throw new Error(`invalid number '${label}'`);
			return n;
		}
	},
	[DOMAIN_JSON]: {
		coerce: (label: TStepValueValue) => {
			if (typeof label !== 'string') throw new Error(`invalid json '${String(label)}'`);
			try {
				JSON.parse(label);
				return label;
			}
			catch { throw new Error(`invalid json '${label}'`); }
		}
	},
	[DOMAIN_STATEMENT]: {
		coerce: async (label: TStepValueValue, steppers) => {
			const lbl = String(label);
			return <TStepValueValue><unknown>await findFeatureStepsFromStatement(lbl, steppers, world, `<${DOMAIN_STATEMENT}.${lbl}>`);
		}
	}
});
