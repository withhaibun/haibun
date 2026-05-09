import type { AStepper } from "./astepper.js";
import { constructorName } from "./util/index.js";
import type { TStepperOption } from "./astepper.js";

/**
 * Declarative bound on a tunable option. The four kinds are deliberately
 * narrow — richer validation belongs in the option's own `parse`, not here.
 */
export type TTunableRange =
	| { kind: "number"; min?: number; max?: number }
	| { kind: "duration"; minMs?: number; maxMs?: number }
	| { kind: "boolean" }
	| { kind: "enum"; values: string[] };

/**
 * How often a tunable may be changed. Enforced server-side at the
 * Development-write RPC boundary; a misbehaving client cannot bypass it.
 */
export type TTunableRateLimit = {
	maxChangesPerDay: number;
	/** Optional minimum relative step size — e.g. 0.1 for "at least 10% change". */
	minStepPct?: number;
};

/**
 * One tunable option declaration. A superset of TStepperOption — same
 * desc / parse / etc. plus range bounds, an optional rate limit, and an
 * optional capability gate.
 *
 * When `requiresCapability` is omitted, the default capability name is
 * derived from the owning stepper + key via `requiredCapabilityFor`.
 * Prefer the derived name over a hard-coded literal so the gate is not
 * coupled to any particular consumer.
 */
export type TTunableOption = TStepperOption & {
	range: TTunableRange;
	rateLimit?: TTunableRateLimit;
	requiresCapability?: string;
};

/**
 * Derive the default capability a caller must hold to change the
 * tunable `<stepperName>.<key>`. Consumers that haven't declared
 * `requiresCapability` explicitly fall back to this structural name.
 * Consumers that grant capabilities should construct matches against
 * this function, never via string literals.
 */
export function requiredCapabilityFor(stepperName: string, key: string): string {
	return `${stepperName}:tune:${key}`;
}

/**
 * Discovery contract: steppers that expose tunable options — options a
 * caller may propose changes to within their declared bounds — declare
 * them in a `tunables` map parallel to `options`. Non-tunable steppers
 * simply omit the property.
 */
export interface IHasTunables {
	tunables?: {
		[name: string]: TTunableOption;
	};
}

/**
 * Enumerate every tunable declared by any stepper in the list. Steppers
 * with no `tunables` property are skipped silently.
 */
export function getTunableOptions(steppers: AStepper[]): Array<{ stepperName: string; key: string; meta: TTunableOption }> {
	const out: Array<{ stepperName: string; key: string; meta: TTunableOption }> = [];
	for (const stepper of steppers) {
		const withTunables = stepper as unknown as IHasTunables;
		const tunables = withTunables.tunables;
		if (!tunables) continue;
		for (const [key, meta] of Object.entries(tunables)) {
			out.push({ stepperName: constructorName(stepper), key, meta });
		}
	}
	return out;
}
