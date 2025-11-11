import { AStepper } from "./astepper.js";
import { TFeatureStep, TStepValue, TWorld } from "./defs.js";
import { DOMAIN_STATEMENT, DOMAIN_STRING, DOMAIN_NUMBER, DOMAIN_JSON } from './domain-types.js';
import { findFeatureStepsFromStatement } from "./util/featureStep-executor.js";

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
				return JSON.parse(proto.value);
			} catch { throw new Error(`invalid json '${proto.value}'`); }
		}
	},
	[DOMAIN_STATEMENT]: {
		coerce: (proto: TStepValue, featureStep: TFeatureStep, steppers: AStepper[]) => {
			const lbl = String(proto.value);
			const seqStart = featureStep.seqPath;
			// Use the featureStep's path as the base so non-background statements get the correct path
			return findFeatureStepsFromStatement(lbl, steppers, world, featureStep.path, [...seqStart, 0], -1);
		}
	}
});
