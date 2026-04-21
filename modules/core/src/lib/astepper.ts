import { TWorld, IStepperCycles, TStepperStep, TOptionValue, TEnvVariables, IStepperWhen } from "./execution.js";
import { TAnyFixme } from "./fixme.js";
import { constructorName } from "./util/index.js";

export const StepperKinds = {
	MONITOR: "MONITOR",
	STORAGE: "STORAGE",
	BROWSER: "BROWSER",
	SERVER: "SERVER",
	TEST: "TEST",
	/** LLM provider — exposes `ask(prompt, opts?): Promise<string>`. */
	LLM: "LLM",
} as const;

export type TStepperKind = keyof typeof StepperKinds;

export abstract class AStepper {
	description?: string;
	world?: TWorld;
	kind?: TStepperKind;

	async setWorld(world: TWorld, _steppers: AStepper[]) {
		this.world = world;
		// some steppers like to keep a reference to all steppers
		void _steppers;
		await Promise.resolve();
	}
	abstract steps: TStepperSteps;
	getWorld() {
		if (!this.world) {
			throw Error(`stepper without world ${constructorName(this)}`);
		}

		return this.world;
	}

	/**
	 * Called by Resolver before resolving each feature.
	 * Steppers can override to clear feature-scoped steps that shouldn't leak between features.
	 */
	startFeatureResolution?(_path: string): void;
}
export type TStepperSteps = {
	[key: string]: TStepperStep;
};
/** One stepper option declaration — the small, non-tunable shape every stepper has used. */
export type TStepperOption = {
	required?: boolean;
	altSource?: string;
	default?: string;
	desc: string;
	parse: (input: string, existing?: TOptionValue) => { parseError?: string; env?: TEnvVariables; result?: TAnyFixme };
};

export interface IHasOptions {
	options?: {
		[name: string]: TStepperOption;
	};
}

export interface IHasCycles {
	cycles: IStepperCycles;
	cyclesWhen?: IStepperWhen;
}

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
 * desc / parse / etc. plus the autonomic envelope (range, rateLimit,
 * requiresCapability).
 *
 * When `requiresCapability` is omitted, a default can be derived from
 * the owning stepper + key via `requiredCapabilityFor(stepperName,
 * key)`. Declaring a consumer-namespaced literal (e.g. `Autonomic:
 * apply:FOO`) in a non-autonomic stepper couples it to that consumer;
 * omitting the field and relying on the derived default avoids the
 * leak.
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
 * reasoning loop (the autonomic MAPE-K loop) may propose changes to within
 * their declared bounds — declare them in a `tunables` map parallel to
 * `options`. Non-tunable steppers simply omit the property.
 *
 * Discovered the same way IHasOptions / IHasCycles are — by introspection
 * for the property, no instanceof check required. The CLI `--help`
 * surface, the autonomic discovery path, and any other consumer all use
 * the same duck-typed lookup.
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
export function getTunableOptions(
	steppers: AStepper[],
): Array<{ stepperName: string; key: string; meta: TTunableOption }> {
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
