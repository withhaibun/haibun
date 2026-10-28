import { type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import { OBSCURED_VALUE } from "@haibun/core/lib/steps/domains/secrets.js";
import { SECRETS } from "./shu-self-test.feature.ts";

// The negative assertion below checks the full secret value (SECRETS.TEST_PASSWORD) and not the bare fragment
// (SECRETS.FRAGMENT, "ISECRET"). Haibun loads every feature source at the start and includes the sources in the
// standalone report's events. The redaction pass replaces each occurrence of each secret value with OBSCURED_VALUE in
// the report's payload, so it also redacts the full value in this assertion's own line. The bare fragment would
// stay in that line, and the check would fail although the secret didn't leak. A leak shows the full value, so
// the full value is the string to check.
export const features: TKirejiExport = {
	"Verify Shu Standalone Output Doesn't Hold Secrets": [
		`Scenario: Check the standalone output obscures secrets
    storage entry "/tmp/shu-audit.html" exists

    The file's age shows that the current test run wrote it. A file that an earlier test run left fails the check. The window spans a test run, not a moment. The self-test writes this copy part way through its steps and runs for minutes afterwards. A window measured in seconds would report this file as stale while the feature continues.
    file "/tmp/shu-audit.html" is recent within 10 minutes

    The first check requires the obscured marker. The marker shows that the report holds an obscured secret. The next check alone would also pass on a report that didn't hold a secret.
    text at "/tmp/shu-audit.html" contains "${OBSCURED_VALUE}"
    The output must not hold the raw secret value.
    didn't text at "/tmp/shu-audit.html" contains "${SECRETS.TEST_PASSWORD}"
    `,
	],
};
