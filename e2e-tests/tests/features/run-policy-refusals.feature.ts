import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import InstanceStepper from "@haibun/cli/instance-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";

const { startRun, waitRun } = withAction(new InstanceStepper());
const { setFromStatement, is, matches } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());

/** The configs of the refused runs, each a package's export. */
const REFUSALS = "@haibun/e2e-tests/policy-refusals";
/** The config of the policy features that doesn't name a policy's schema. */
const WITHOUT_POLICY = "@haibun/e2e-tests/policy-test/config-no-policy.json";

/** A run of `where` ends, and its output states `refusal`. */
const ended = (run: string, where: string, refusal: string) => [
	startRun({ where: `"${where}"`, filter: '""', from: '"."', port: "0", run: `"${run}"`, hostId: "0" }),
	setFromStatement({ what: run, statement: waitRun({ run: `"${run}"`, seconds: "60" }) }),
	matches({ value: `${run}.output`, pattern: `"*${refusal}*"` }),
];
/** A run of `where` refuses to start its features: it exits with code 1, and its output states `refusal`. */
const refused = (run: string, where: string, refusal: string) => [...ended(run, where, refusal), is({ what: `${run}.exitCode`, value: "1" })];

export const features: TKirejiExport = {
	"A run refuses a run policy its config doesn't allow": [
		feature({ feature: "A run refuses a run policy its config doesn't allow" }),

		"A run policy names a place and the access each folder of features has there. A config names the schema the policy satisfies, and its parameters for each place. A run refuses a policy before its features where the policy doesn't satisfy the schema or the config doesn't name one, and its features fail without a policy where they read the parameters a place gives them.",

		scenario({ scenario: "A policy that writes to a place whose schema allows only reads" }),
		...refused("writesToProd", `${REFUSALS}/writes-to-prod`, "Run policy validation failed"),

		scenario({ scenario: "A policy whose config doesn't name a schema" }),
		...refused("withoutSchema", `${REFUSALS}/without-schema`, "naming the policy's schema"),

		scenario({ scenario: "The policy features without a policy" }),
		...ended("withoutPolicy", WITHOUT_POLICY, "the variable THIS_PLACE isn't set"),
		is({ what: "withoutPolicy.actuality", value: '"failed"' }),
	],
};
