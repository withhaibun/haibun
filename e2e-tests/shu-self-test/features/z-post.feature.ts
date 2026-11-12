import { type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import { OBSCURED_VALUE } from "@haibun/core/lib/steps/domains/secrets.js";
import { SECRETS } from "./shu-self-test.feature.ts";

export const features: TKirejiExport = {
	"Verify Shu Standalone Output Doesn't Hold Secrets": [
		`Scenario: Check the standalone output obscures secrets
    storage entry "/tmp/shu-audit.html" exists

    The file's age shows that the current test run wrote it. A file that an earlier test run left fails the check. The window spans a test run, not a moment. The self-test writes this copy part way through its steps and runs for minutes afterwards. A window measured in seconds would report this file as stale while the feature continues.
    file "/tmp/shu-audit.html" is recent within 10 minutes

    The first check requires the obscured marker. The marker shows that the report holds an obscured secret. The next check alone would also pass on a report that didn't hold a secret.
    text at "/tmp/shu-audit.html" contains "${OBSCURED_VALUE}"

    The negative assertion checks the full secret value and not the bare fragment. The redaction pass replaces each occurrence of each secret value with the obscured marker in the report payload, so the full value is verified as absent.
    didn't text at "/tmp/shu-audit.html" contains "${SECRETS.TEST_PASSWORD}"
    `,
	],
};
