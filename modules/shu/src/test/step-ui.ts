import { withAction, type TKirejiStep } from "@haibun/core/kireji/withAction.js";
import type WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import { SHU_TEST_IDS } from "../test-ids.js";

export function flattenTestIds(obj: Record<string, unknown>): string[] {
	const result: string[] = [];
	for (const [, value] of Object.entries(obj)) {
		if (typeof value === "string") result.push(value);
		else if (typeof value === "object" && value !== null) result.push(...flattenTestIds(value as Record<string, unknown>));
	}
	return result;
}

const IDS = SHU_TEST_IDS;

const CURRENT_RUN = "current-step-run";
const CURRENT_RESULT = "current-step-result";
const CURRENT_ERROR = "current-step-error";
const CURRENT_INPUT = (param: string) => `current-step-input-${param}`;

export function stepTestIds(inputParams: string[]): string[] {
	return [CURRENT_RUN, CURRENT_RESULT, CURRENT_ERROR, ...inputParams.map(CURRENT_INPUT)];
}

export function createStepUI(wp: WebPlaywright) {
	const { waitFor, click, setValue, selectionOption } = withAction(wp);
	const { setAs } = withAction(new VariablesStepper());

	const enterStepMode: TKirejiStep[] = [
		waitFor({ target: IDS.APP.TWISTY }),
		click({ target: IDS.APP.TWISTY }),
		"page has settled",
		selectionOption({ option: '"Step"', field: IDS.APP.MODE_SELECT }),
		"page has settled",
		waitFor({ target: IDS.APP.STEP_SELECT }),
	];

	function runStep(stepName: string, passes: boolean, params: Record<string, string> = {}): TKirejiStep[] {
		const paramEntries = Object.entries(params);
		const expectedTarget = passes ? CURRENT_RESULT : CURRENT_ERROR;
		// Click the combobox to open its dropdown, then click the rendered option
		// by its per-step testid. Avoids Playwright/shadow-DOM Enter-key races
		// where filterText/focusIndex don't survive the keydown round trip.
		const optionTestId = `${IDS.APP.STEP_SELECT}-option-${stepName}`;
		return [
			setAs({ what: optionTestId, domain: "page-test-id", value: `"${optionTestId}"` }),
			click({ target: IDS.APP.STEP_SELECT }),
			waitFor({ target: optionTestId }),
			click({ target: optionTestId }),
			...(paramEntries.length > 0
				? [
						waitFor({ target: CURRENT_INPUT(paramEntries[0][0]) }),
						// Use setValue so the helper doesn't have to know whether the rendered
						// param is an <input> or a <select>: setValue dispatches by element type.
						...paramEntries.map(([name, value]) => setValue({ what: value, field: CURRENT_INPUT(name) })),
					]
				: []),
			click({ target: CURRENT_RUN }),
			"page has settled",
			waitFor({ target: expectedTarget }),
		];
	}

	function passesStepExecution(stepName: string, params: Record<string, string> = {}): TKirejiStep[] {
		return runStep(stepName, true, params);
	}

	function failsStepExecution(stepName: string, params: Record<string, string> = {}): TKirejiStep[] {
		return runStep(stepName, false, params);
	}

	/** Open actions bar and select a vertex type from the type dropdown. */
	function chooseGraphLabel(label: string): TKirejiStep[] {
		return [
			waitFor({ target: IDS.APP.TWISTY }),
			click({ target: IDS.APP.TWISTY }),
			waitFor({ target: IDS.APP.TYPE_SELECT }),
			selectionOption({ option: `"${label}"`, field: IDS.APP.TYPE_SELECT }),
		];
	}

	return { enterStepMode, runStep, passesStepExecution, failsStepExecution, chooseGraphLabel };
}
