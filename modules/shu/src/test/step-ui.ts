import type { TKirejiStep } from "@haibun/core/kireji/withAction.js";
import { SHU_TEST_IDS } from "../test-ids.js";

const IDS = SHU_TEST_IDS;

const CURRENT_RUN = "current-step-run";
const CURRENT_RESULT = "current-step-result";
const CURRENT_ERROR = "current-step-error";
const CURRENT_INPUT = (param: string) => `current-step-input-${param}`;

export function stepTestIds(inputParams: string[]): string[] {
	return [CURRENT_RUN, CURRENT_RESULT, CURRENT_ERROR, ...inputParams.map(CURRENT_INPUT)];
}

function buildInputSteps(params: Record<string, string>): string[] {
	const paramEntries = Object.entries(params);
	if (paramEntries.length === 0) return [];
	const steps: string[] = [`waitFor ${CURRENT_INPUT(paramEntries[0][0])}`];
	for (const [name, value] of paramEntries) {
		steps.push(`inputVariable ${value} to ${CURRENT_INPUT(name)}`);
	}
	return steps;
}

function executeStep(stepName: string, params: Record<string, string> = {}, passes: boolean): TKirejiStep[] {
	const paramSteps = buildInputSteps(params);
	const expectedTarget = passes ? CURRENT_RESULT : CURRENT_ERROR;
	return [
		`waitFor ${IDS.APP.TWISTY}`,
		`click ${IDS.APP.TWISTY}`,
		"page has settled",
		`selectionOption Step from ${IDS.APP.MODE_SELECT}`,
		"page has settled",
		`waitFor ${IDS.APP.STEP_SELECT}`,
		`click ${IDS.APP.STEP_SELECT}`,
		`inputVariable "${stepName}" to ${IDS.APP.STEP_SELECT}`,
		"press Enter",
		...paramSteps,
		`click ${CURRENT_RUN}`,
		"page has settled",
		`waitFor ${expectedTarget}`,
	];
}

export function passesStepExecution(stepName: string, params: Record<string, string> = {}): TKirejiStep[] {
	return executeStep(stepName, params, true);
}

export function failsStepExecution(stepName: string, params: Record<string, string> = {}): TKirejiStep[] {
	return executeStep(stepName, params, false);
}