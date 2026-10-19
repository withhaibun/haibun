import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());
const GROUP = '"once"';

export const features: TKirejiExport = {
	"The command line": [
		feature({ feature: "The command line" }),
		`The engine serves every option of haibun-cli (run-cli.ts:339, base-options.ts:19, run-policy.ts:9): a base and its filters, --config, --cwd, --help, --show-steppers, --with-steppers, --statement, --run-policy and HAIBUN_RUN_POLICY, --dry-run, --once and HAIBUN_ONCE, and HAIBUN_KEY, HAIBUN_STAY, HAIBUN_NDJSON, HAIBUN_CONTINUE_AFTER_ERROR, HAIBUN_ENV, HAIBUN_STEP_DELAY, HAIBUN_HOST_ID, HAIBUN_LOG_LEVEL and PWDEBUG, with a config's extends, moduleOptions, dependsOn and environments (execution.ts:14). These are essential. run-cli.test.ts and actualities.test.ts hold most of them, and the policy-test and once groups hold the rest.
		Unclear: HAIBUN_SETTING and HAIBUN_LOG_FOLLOW are parsed and not read (world.ts:91-93), and HAIBUN_DESCRIPTION is read only to leave it out of the actualities key (actualities.ts:75).`,

		scenario({ scenario: "A group runs once per state of what it depends on" }),
		"Essential, for --once and an agent's runs. Source: actualities.ts:140 and once.feature.ts.",
		`note that the tests in ${GROUP} have changed`,
		`run all the tests in ${GROUP}`,
		"set ended from wait until the test run ends within 120 seconds",
		'variable ended.status is "passed"',
		`not run all the tests in ${GROUP}`,
	],
};
