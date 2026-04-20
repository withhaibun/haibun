import { describe, it, expect } from "vitest";
import { AStepper, getTunableOptions, type IHasTunables, type TStepperSteps, type TTunableOption } from "./astepper.js";
import { intOrError } from "./util/index.js";

class PlainStepper extends AStepper {
	description = "no tunables declared";
	steps: TStepperSteps = {};
}

class TunableA extends AStepper implements IHasTunables {
	description = "declares one tunable";
	steps: TStepperSteps = {};
	tunables = {
		CYCLE_MS: {
			desc: "cycle tick interval",
			parse: intOrError,
			range: { kind: "duration" as const, minMs: 1000, maxMs: 3_600_000 },
			rateLimit: { maxChangesPerDay: 12 },
			requiresCapability: "Autonomic:apply:cycleMs",
		},
	};
}

class TunableMixed extends AStepper implements IHasTunables {
	description = "declares tunables of several kinds";
	steps: TStepperSteps = {};
	tunables = {
		RETENTION_DAYS: {
			desc: "retain knowledge for N days",
			parse: intOrError,
			range: { kind: "number" as const, min: 1, max: 365 },
		},
		ENABLE_FANCY: {
			desc: "feature toggle",
			parse: (input: string) => ({ result: input === "true" }),
			range: { kind: "boolean" as const },
		},
		MODE: {
			desc: "operating mode",
			parse: (input: string) => ({ result: input }),
			range: { kind: "enum" as const, values: ["local", "remote", "offline"] },
			rateLimit: { maxChangesPerDay: 3 },
		},
	};
}

class TunableEmpty extends AStepper implements IHasTunables {
	description = "implements IHasTunables but declares none (tunables property absent)";
	steps: TStepperSteps = {};
}

describe("getTunableOptions", () => {
	it("returns empty for a stepper that does not implement IHasTunables", () => {
		expect(getTunableOptions([new PlainStepper()])).toEqual([]);
	});

	it("returns empty for an IHasTunables stepper with no tunables declared", () => {
		expect(getTunableOptions([new TunableEmpty()])).toEqual([]);
	});

	it("enumerates a single tunable and preserves its full metadata", () => {
		const tunables = getTunableOptions([new TunableA()]);
		expect(tunables).toHaveLength(1);
		const t = tunables[0];
		expect(t.stepperName).toBe("TunableA");
		expect(t.key).toBe("CYCLE_MS");
		expect(t.meta.range.kind).toBe("duration");
		expect(t.meta.rateLimit?.maxChangesPerDay).toBe(12);
		expect(t.meta.requiresCapability).toBe("Autonomic:apply:cycleMs");
	});

	it("handles multiple range kinds in one stepper", () => {
		const tunables = getTunableOptions([new TunableMixed()]);
		const keys = tunables.map((t) => t.key).sort();
		expect(keys).toEqual(["ENABLE_FANCY", "MODE", "RETENTION_DAYS"]);
		const byKind = Object.fromEntries(tunables.map((t) => [t.key, t.meta.range.kind]));
		expect(byKind.RETENTION_DAYS).toBe("number");
		expect(byKind.ENABLE_FANCY).toBe("boolean");
		expect(byKind.MODE).toBe("enum");
	});

	it("combines tunables across mixed stepper lists, ignoring non-tunable ones", () => {
		const tunables = getTunableOptions([new PlainStepper(), new TunableA(), new TunableMixed(), new TunableEmpty()]);
		expect(tunables).toHaveLength(4); // 0 + 1 + 3 + 0
		const names = new Set(tunables.map((t) => t.stepperName));
		expect(names).toEqual(new Set(["TunableA", "TunableMixed"]));
	});

	it("discovery is duck-typed on the `tunables` property, not an instanceof check", () => {
		// Mirrors how CLI --help walks options / cycles: introspect the property,
		// no instanceof of some ATunableStepper base class.
		class NotDeclared extends AStepper {
			description = "has a tunables field without declaring IHasTunables in its types";
			steps: TStepperSteps = {};
			tunables = {
				QUIET: {
					desc: "quiet mode",
					parse: (s: string) => ({ result: s === "true" }),
					range: { kind: "boolean" as const },
				},
			};
		}
		const tunables = getTunableOptions([new NotDeclared()]);
		expect(tunables.map((t) => t.key)).toEqual(["QUIET"]);
	});

	it("type-system sanity: TTunableOption has a required range field", () => {
		const t: TTunableOption = {
			desc: "",
			parse: (s) => ({ result: s }),
			range: { kind: "boolean" },
		};
		expect(t.range.kind).toBe("boolean");
	});
});
