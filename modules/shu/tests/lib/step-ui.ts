import { withAction, type TKirejiStep } from "@haibun/core/kireji/withAction.js";
import type WebPlaywright from "@haibun/web-playwright";
import { SHU_TEST_IDS } from "../../build/test-ids.js";

const IDS = SHU_TEST_IDS;

const CURRENT_RUN = "current-step-run";
const CURRENT_RESULT = "current-step-result";
const CURRENT_ERROR = "current-step-error";
const CURRENT_INPUT = (param: string) => `current-step-input-${param}`;

export function stepTestIds(inputParams: string[]): string[] {
	return [CURRENT_RUN, CURRENT_RESULT, CURRENT_ERROR, ...inputParams.map(CURRENT_INPUT)];
}

export function createStepUI(wp: WebPlaywright) {
	const { waitFor, click, inputVariable, press, selectionOption } = withAction(wp);

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
		return [
			click({ target: IDS.APP.STEP_SELECT }),
			inputVariable({ what: `"${stepName}"`, field: IDS.APP.STEP_SELECT }),
			press({ key: '"Enter"' }),
			...(paramEntries.length > 0
				? [
						waitFor({ target: CURRENT_INPUT(paramEntries[0][0]) }),
						...paramEntries.map(([name, value]) => inputVariable({ what: value, field: CURRENT_INPUT(name) })),
					]
				: []),
			click({ target: CURRENT_RUN }),
			"page has settled",
			waitFor({ target: expectedTarget }),
		];
	}

	return { enterStepMode, runStep };
}
