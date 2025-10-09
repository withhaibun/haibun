import { AStepper } from "./astepper.js";
import { TDomainDefinition, TFeatureStep, TStepValue, TStepValueValue, TWorld } from "./defs.js";
import { findFeatureStepsFromStatement } from "./util/featureStep-executor.js";

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
		coerce: (proto: TStepValue) => String(proto.value),
	},
	[DOMAIN_NUMBER]: {
		coerce: (proto: TStepValue) => {
			if (typeof proto.value !== 'string' && typeof proto.value !== 'number') throw new Error(`invalid number '${String(proto.value)}'`);
			const n = Number(proto.value);
			if (isNaN(n)) throw new Error(`invalid number '${proto.value}'`);
			return n;
		}
	},
	[DOMAIN_JSON]: {
		coerce: (proto: TStepValue) => {
			if (typeof proto.value !== 'string') throw new Error(`invalid json '${String(proto.value)}'`);
			try {
				JSON.parse(proto.value);
				return proto.value;
			}
			catch { throw new Error(`invalid json '${proto.value}'`); }
		}
	},
	[DOMAIN_STATEMENT]: {
		coerce: (proto: TStepValue, featureStep: TFeatureStep, steppers: AStepper[]) => {
			const lbl = String(proto.value);
			const seqStart = featureStep.seqPath;
			return <TStepValueValue>findFeatureStepsFromStatement(lbl, steppers, world, `<${DOMAIN_STATEMENT}.${lbl}>`, [...seqStart, 0], -1);
		}
	}
});

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
