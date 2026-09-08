import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import TestRunnerStepper from "@haibun/cli/test-runner-stepper.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import LogicStepper from "@haibun/core/steps/logic-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";

const { noteEverythingChanged } = withAction(new TestRunnerStepper());
const { issueSessionGrant } = withAction(new AuthorityStepper());
const { setFromStatement, is } = withAction(new VariablesStepper());
const { not } = withAction(new LogicStepper());
const { feature, scenario } = withAction(new Haibun());

const TOKEN = '"once-token"';
const GROUP = '"once"';
const RUN_ALL = `with token ${TOKEN}, run all the tests in ${GROUP}`;
const WAIT = `with token ${TOKEN}, wait until the test run ends within 120 seconds`;

export const features: TKirejiExport = {
	"A group of features runs once per state of what it depends on": [
		feature({ feature: "A group of features runs once per state of what it depends on" }),

		"A run of features is verified against the content of what the features depend on: the directory they are read from, and the module of every stepper their configuration names. A group that has passed against the state its dependencies have now is not run again, since that run would answer what the last run answered. Noting that the group has changed forgets the pass, which is how a caller asks for the run regardless.",

		scenario({ scenario: "A run of a group passes and records what it passed against" }),
		issueSessionGrant({ token: TOKEN, action: '"Instance:run"' }),
		issueSessionGrant({ token: TOKEN, action: '"Instance:read"' }),
		"Whatever an earlier run of this feature recorded is forgotten first, so the scenario starts from the same place every time it runs.",
		noteEverythingChanged({ where: GROUP }),
		RUN_ALL,
		setFromStatement({ what: '"ended"', statement: WAIT }),
		is({ what: "ended.status", value: '"passed"' }),

		scenario({ scenario: "A second run against the same state is refused" }),
		"Nothing the group depends on has changed since it passed, so a run would answer what that run answered, and it is not started.",
		not({ statements: RUN_ALL }),

		scenario({ scenario: "Noting that the group changed lets it run again" }),
		noteEverythingChanged({ where: GROUP }),
		RUN_ALL,
		setFromStatement({ what: '"again"', statement: WAIT }),
		is({ what: "again.status", value: '"passed"' }),
	],
};
