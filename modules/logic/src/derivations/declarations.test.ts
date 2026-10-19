/**
 * One declaration: start-up refuses steppers whose declarations miss a face, repeat a pattern, or state a pattern whose own
 * line parses two ways, and the core steppers with the logic stepper declare each step once with every face.
 */
import { describe, expect, it } from "vitest";
import { AStepper, READING, type TStepperSteps } from "@haibun/core/lib/steps/domains/stepper.js";
import { actionOK, constructorName } from "@haibun/core/lib/domains/util.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import DebuggerStepper from "@haibun/core/steps/debugger-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import NarratorStepper from "@haibun/core/steps/narrator-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import { refuseDeclarations } from "../pipelines/registry-reads.js";
import LogicStepper from "../logic-stepper.js";
import { DUPLICATE_PATTERN, MISSING_FUNCTOR, MISSING_PATTERN, PARSES_TWO_WAYS } from "./declarations.js";

const action = async () => actionOK();

/** A stepper that declares the steps a case states. */
const declaring = (steps: TStepperSteps): AStepper =>
	new (class Declaring extends AStepper {
		description = "Declares the steps a case of the test states.";
		steps = steps;
	})();

const REFUSED: [string, TStepperSteps[], string][] = [
	["a step without a pattern", [{ open: { action } } as unknown as TStepperSteps], MISSING_PATTERN],
	["a step without an action or a reading", [{ open: { gwta: "open the door" } } as unknown as TStepperSteps], MISSING_FUNCTOR],
	["a pattern two steps declare", [{ open: { gwta: "open {door}", action } }, { unlock: { gwta: "open {gate}", action } }], DUPLICATE_PATTERN],
	["a pattern whose own line parses to another step", [{ open: { gwta: "open the {door}", action } }, { any: { gwta: "open {what}", action } }], PARSES_TWO_WAYS],
];

describe("one declaration", () => {
	it.each(REFUSED)("start-up refuses %s", (_, declared, finding) => {
		expect(() => refuseDeclarations(declared.map(declaring))).toThrow(finding);
	});

	it("start-up holds a reading as a step's functor", () => {
		expect(() => refuseDeclarations([declaring({ never: { gwta: "never {statement: statement}", reading: READING.not } })])).not.toThrow();
	});

	it("the core steppers with the logic stepper declare each step once with every face", () => {
		const steppers = [Haibun, VariablesStepper, NarratorStepper, ActivitiesStepper, AuthorityStepper, DebuggerStepper, LogicStepper].map((Stepper) => new Stepper());
		expect(steppers.map(constructorName)).toHaveLength(7);
		expect(() => refuseDeclarations(steppers)).not.toThrow();
	});
});
