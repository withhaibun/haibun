import { TWorld, IStepperCycles, TStepperStep, TOptionValue, TEnvVariables, IStepperWhen } from "./execution.js";
import { TAnyFixme } from "./fixme.js";
import { constructorName } from "./util/index.js";

export const StepperKinds = {
	MONITOR: "MONITOR",
	STORAGE: "STORAGE",
	BROWSER: "BROWSER",
	SERVER: "SERVER",
	TEST: "TEST",
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
/**
 * Declarative bound on a stepper option. When present, the option is
 * "tunable" — a reasoning loop (e.g. the autonomic MAPE-K loop) may
 * propose changes within these bounds. Absence means the option is not
 * tunable and the reasoning loop must leave it alone.
 *
 * Keep the four kinds narrow and obvious. If a tunable needs richer
 * validation than these cover, it belongs in its own option-specific
 * validator via `parse`, not in this declarative surface.
 */
export type TStepperOptionRange =
	| { kind: "number"; min?: number; max?: number }
	| { kind: "duration"; minMs?: number; maxMs?: number }
	| { kind: "boolean" }
	| { kind: "enum"; values: string[] };

/**
 * How often a tunable may be changed. Enforced server-side at the
 * Development-write RPC boundary; a misbehaving client cannot bypass it.
 */
export type TStepperOptionRateLimit = {
	maxChangesPerDay: number;
	/** Optional minimum relative step size — e.g. 0.1 for "at least 10% change". */
	minStepPct?: number;
};

/**
 * One stepper option's declaration. The core shape (required, altSource,
 * default, desc, parse) is legacy. The three new fields — range,
 * rateLimit, requiresCapability — declare the tunable envelope for
 * reasoning loops. Absence of `range` means the option is not tunable.
 */
export type TStepperOption = {
	required?: boolean;
	altSource?: string;
	default?: string;
	desc: string;
	parse: (input: string, existing?: TOptionValue) => { parseError?: string; env?: TEnvVariables; result?: TAnyFixme };
	/** Declarative bound. Present iff the option is tunable. */
	range?: TStepperOptionRange;
	/** Rate limit on changes. Meaningful only when `range` is present. */
	rateLimit?: TStepperOptionRateLimit;
	/** Capability required to change this option via the autonomic path (e.g. "Autonomic:apply:cycleMs"). */
	requiresCapability?: string;
};

export interface IHasOptions {
	options?: {
		[name: string]: TStepperOption;
	};
}

/**
 * Enumerate every tunable option declared by any stepper in the list.
 * An option is tunable iff it declares `range`. The autonomic loop
 * reads this to discover what it may propose changes to.
 */
export function getTunableOptions(
	steppers: AStepper[],
): Array<{ stepperName: string; key: string; meta: TStepperOption }> {
	const out: Array<{ stepperName: string; key: string; meta: TStepperOption }> = [];
	for (const stepper of steppers) {
		const withOpts = stepper as unknown as IHasOptions;
		const opts = withOpts.options;
		if (!opts) continue;
		for (const [key, meta] of Object.entries(opts)) {
			if (meta.range) {
				out.push({ stepperName: constructorName(stepper), key, meta });
			}
		}
	}
	return out;
}

export interface IHasCycles {
	cycles: IStepperCycles;
	cyclesWhen?: IStepperWhen;
}
