import { describe, it, expect } from "vitest";
import { AStepper, IHasOptions, getTunableOptions, type TStepperOption } from "./astepper.js";
import type { TStepperSteps } from "./astepper.js";

class NonTunableStepper extends AStepper implements IHasOptions {
	description = "has options but none declare range";
	steps: TStepperSteps = {};
	options: IHasOptions["options"] = {
		PORT: {
			desc: "listen port",
			parse: (input) => ({ result: Number(input) }),
		},
	};
}

class TunableStepper extends AStepper implements IHasOptions {
	description = "declares one tunable option";
	steps: TStepperSteps = {};
	options: IHasOptions["options"] = {
		CYCLE_MS: {
			desc: "cycle tick interval",
			parse: (input) => ({ result: Number(input) }),
			range: { kind: "duration", minMs: 1000, maxMs: 3_600_000 },
			rateLimit: { maxChangesPerDay: 12 },
			requiresCapability: "Autonomic:apply:cycleMs",
		},
		READ_ONLY: {
			desc: "not tunable — no range",
			parse: (input) => ({ result: input }),
		},
	};
}

class MixedStepper extends AStepper implements IHasOptions {
	description = "declares multiple tunables of different kinds";
	steps: TStepperSteps = {};
	options: IHasOptions["options"] = {
		RETENTION_DAYS: {
			desc: "retain knowledge for N days",
			parse: (input) => ({ result: Number(input) }),
			range: { kind: "number", min: 1, max: 365 },
		},
		ENABLE_FANCY: {
			desc: "feature toggle",
			parse: (input) => ({ result: input === "true" }),
			range: { kind: "boolean" },
		},
		MODE: {
			desc: "operating mode",
			parse: (input) => ({ result: input }),
			range: { kind: "enum", values: ["local", "remote", "offline"] },
			rateLimit: { maxChangesPerDay: 3, minStepPct: undefined },
		},
	};
}

describe("getTunableOptions", () => {
	it("returns empty array when no stepper declares a range", () => {
		const tunables = getTunableOptions([new NonTunableStepper()]);
		expect(tunables).toEqual([]);
	});

	it("enumerates exactly the options that declare range", () => {
		const tunables = getTunableOptions([new TunableStepper()]);
		expect(tunables).toHaveLength(1);
		expect(tunables[0].key).toBe("CYCLE_MS");
		expect(tunables[0].stepperName).toBe("TunableStepper");
	});

	it("preserves rateLimit and requiresCapability in the returned meta", () => {
		const tunables = getTunableOptions([new TunableStepper()]);
		const cycle = tunables[0];
		expect(cycle.meta.rateLimit?.maxChangesPerDay).toBe(12);
		expect(cycle.meta.requiresCapability).toBe("Autonomic:apply:cycleMs");
		expect(cycle.meta.range?.kind).toBe("duration");
	});

	it("handles multiple range kinds in one stepper", () => {
		const tunables = getTunableOptions([new MixedStepper()]);
		const keys = tunables.map((t) => t.key).sort();
		expect(keys).toEqual(["ENABLE_FANCY", "MODE", "RETENTION_DAYS"]);
		const byKind = Object.fromEntries(tunables.map((t) => [t.key, t.meta.range?.kind]));
		expect(byKind.RETENTION_DAYS).toBe("number");
		expect(byKind.ENABLE_FANCY).toBe("boolean");
		expect(byKind.MODE).toBe("enum");
	});

	it("combines tunables across multiple steppers", () => {
		const tunables = getTunableOptions([new NonTunableStepper(), new TunableStepper(), new MixedStepper()]);
		expect(tunables).toHaveLength(4); // 0 + 1 + 3
		const names = new Set(tunables.map((t) => t.stepperName));
		expect(names).toEqual(new Set(["TunableStepper", "MixedStepper"]));
	});

	it("ignores steppers with no options property at all", () => {
		class NoOpts extends AStepper {
			steps: TStepperSteps = {};
		}
		const tunables = getTunableOptions([new NoOpts()]);
		expect(tunables).toEqual([]);
	});

	it("type-system sanity: a TStepperOption with no range is inferred as non-tunable", () => {
		// Purely type-level — this compiles only if the shape is correct.
		const opt: TStepperOption = {
			desc: "plain option",
			parse: (s) => ({ result: s }),
		};
		expect(opt.range).toBeUndefined();
	});
});
