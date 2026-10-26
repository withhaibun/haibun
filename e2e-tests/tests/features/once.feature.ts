import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import TestRunnerStepper from "@haibun/cli/test-runner-stepper.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import { testRuns } from "@haibun/cli/waypoints/backgrounds/test-runs.feature.ts";

const { noteEverythingChanged } = withAction(new TestRunnerStepper());
const { not } = withAction(new LogicStepper());
const { feature, scenario } = withAction(new Haibun());
const { setFromStatement, matches } = withAction(new VariablesStepper());

const GROUP = '"once"';
const RUN_ALL = `run all the tests in ${GROUP}`;
const PASS = testRuns.pass(GROUP, "120");

export const features: TKirejiExport = {
	"A group of features runs once per state of what it depends on": [
		feature({ feature: "A group of features runs once per state of what it depends on" }),

		"A run of features is verified against the content of its dependencies. The dependencies include the directory that holds the features and the module of every stepper their configuration names. A group that passed doesn't run again against unchanged dependencies while its outcome is recorded. A run over unchanged dependencies would repeat the last run's outcome. Noting that the group has changed deletes the recorded outcome. The next run of the group starts without a change to a dependency.",

		scenario({ scenario: "A run of a group passes and records what it passed against" }),
		"The first step deletes any outcome recorded for the group, so each run of this scenario starts from the same state.",
		noteEverythingChanged({ where: GROUP }),
		PASS,

		scenario({ scenario: "A second run against the same state is refused" }),
		"The group's dependencies haven't changed since the group passed. A second run would repeat that outcome, so the step that starts a run fails without starting one.",
		setFromStatement({ what: "secondRun", statement: not({ statements: RUN_ALL }) }),
		matches({ value: "secondRun.refusal", pattern: '"*passed against its present dependencies*"' }),

		scenario({ scenario: "Noting that the group changed lets it run again" }),
		noteEverythingChanged({ where: GROUP }),
		PASS,
	],
};
