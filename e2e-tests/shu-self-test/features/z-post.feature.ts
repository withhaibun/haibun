import { type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import { OBSCURED_VALUE } from "@haibun/core/lib/feature-variables.js";
import { SECRETS } from "./shu-self-test.feature.ts";

export const features: TKirejiExport = {
	"Verify No Secrets in Shu Standalone Output": [
		`Scenario: Check shu.html for obscured passwords
    storage entry "/tmp/shu.html" exists
    file "/tmp/shu.html" is recent within 2 minutes

    Make sure secrets were obscured in the standalone output.
    text at "/tmp/shu.html" contains "${OBSCURED_VALUE}"
    not text at "/tmp/shu.html" contains "${SECRETS.FRAGMENT}_"
    `,
	],
};
