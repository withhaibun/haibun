import { type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import { OBSCURED_VALUE } from "@haibun/core/lib/feature-variables.js";
import { SECRETS } from "./self-test.feature.ts";

// Check each full secret value individually. Asserting against the shared
// FRAGMENT alone is self-defeating: the assertion's own step text contains
// that fragment as a literal, so it always appears in the monitor output.
export const features: TKirejiExport = {
	"Verify No Secrets in Monitor Output": [
		`Scenario: Check monitor output for obscured passwords
		This must be run separately from the main self-test to avoid having secrets in the monitor output.
    storage entry "/tmp/monitor.html" exists
    file "/tmp/monitor.html" is recent within 2 minutes

    Make sure obscuration occured for both environment and composed variables.
    text at "/tmp/monitor.html" contains "${OBSCURED_VALUE}"
    not text at "/tmp/monitor.html" contains "${SECRETS.SNAKE_CASE}"
    not text at "/tmp/monitor.html" contains "${SECRETS.ALL_CAPS}"
    not text at "/tmp/monitor.html" contains "${SECRETS.USER_PASSWORD}"
    `,
	],
};
