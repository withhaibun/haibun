import type { AStepper } from "./astepper.js";
import { constructorName } from "./util/index.js";
import type { TStepperOption } from "./astepper.js";

/**
 * A declarative bound on a tunable option. The four kinds state only simple
 * bounds. The option's own `parse` holds any further validation.
 */
type TTunableRange =
	| { kind: "number"; min?: number; max?: number }
	| { kind: "duration"; minMs?: number; maxMs?: number }
	| { kind: "boolean" }
	| { kind: "enum"; values: string[] };

/**
 * How often a tunable may be changed. getTunableOptions returns it with the
 * option for a consumer to state or enforce. This module doesn't enforce it.
 */
type TTunableRateLimit = {
	maxChangesPerDay: number;
	/** Optional minimum relative step size, e.g. 0.1 for "at least 10% change". */
	minStepPct?: number;
};

/**
 * One tunable option declaration. It extends TStepperOption (desc, parse and
 * the rest) with range bounds, an optional rate limit and an optional
 * capability gate.
 *
 * `requiresCapability` names the capability that a change to the option
 * requires. This module doesn't derive one where it is omitted.
 */
export type TTunableOption = TStepperOption & { range: TTunableRange; rateLimit?: TTunableRateLimit; requiresCapability?: string };

/**
 * The discovery contract for tunable options. A caller may propose a change
 * to a tunable option within its declared bounds. A stepper with tunable
 * options declares them in a `tunables` map beside `options`. A stepper
 * without tunable options omits the property.
 */
export interface IHasTunables {
	tunables?: { [name: string]: TTunableOption };
}

/**
 * Enumerate every tunable that a stepper in the list declares. A stepper
 * without a `tunables` property is skipped.
 */
export function getTunableOptions(steppers: AStepper[]): Array<{ stepperName: string; key: string; meta: TTunableOption }> {
	const out: Array<{ stepperName: string; key: string; meta: TTunableOption }> = [];
	for (const stepper of steppers) {
		if (!hasTunables(stepper)) continue;
		for (const [key, meta] of Object.entries(stepper.tunables)) {
			out.push({ stepperName: constructorName(stepper), key, meta });
		}
	}
	return out;
}

/** A stepper declares tunables when it has a `tunables` object. */
function hasTunables(stepper: AStepper): stepper is AStepper & Required<IHasTunables> {
	return "tunables" in stepper && typeof stepper.tunables === "object" && stepper.tunables !== null;
}
