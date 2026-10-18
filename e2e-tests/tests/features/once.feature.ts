import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import TestRunnerStepper from "@haibun/cli/test-runner-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import LogicStepper from "@haibun/core/steps/logic-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";

const { noteEverythingChanged } = withAction(new TestRunnerStepper());
const { setFromStatement, is } = withAction(new VariablesStepper());
const { not } = withAction(new LogicStepper());
const { feature, scenario } = withAction(new Haibun());

const GROUP = '"once"';
const RUN_ALL = `run all the tests in ${GROUP}`;
const WAIT = "wait until the test run ends within 120 seconds";

export const features: TKirejiExport = {
	"A group of features runs once per state of what it depends on": [
		feature({ feature: "A group of features runs once per state of what it depends on" }),

		"A run of features is verified against the content of its dependencies. The dependencies include the directory that holds the features and the module of every stepper their configuration names. A group that passed doesn't run again against unchanged dependencies while its outcome is recorded. A run over unchanged dependencies would repeat the last run's outcome. Noting that the group has changed deletes the recorded outcome. The next run of the group starts without a change to a dependency.",

		scenario({ scenario: "A run of a group passes and records what it passed against" }),
		"The first step deletes any outcome recorded for the group, so each run of this scenario starts from the same state.",
		noteEverythingChanged({ where: GROUP }),
		RUN_ALL,
		setFromStatement({ what: '"ended"', statement: WAIT }),
		is({ what: "ended.status", value: '"passed"' }),

		scenario({ scenario: "A second run against the same state is refused" }),
		"The group's dependencies haven't changed since the group passed. A second run would repeat that outcome, so the step that starts a run fails without starting one.",
		not({ statements: RUN_ALL }),

		scenario({ scenario: "Noting that the group changed lets it run again" }),
		noteEverythingChanged({ where: GROUP }),
		RUN_ALL,
		setFromStatement({ what: '"again"', statement: WAIT }),
		is({ what: "again.status", value: '"passed"' }),
	],
};
