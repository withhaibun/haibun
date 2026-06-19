import { type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import { OBSCURED_VALUE } from "@haibun/core/lib/feature-variables.js";
import { SECRETS } from "./shu-self-test.feature.ts";

// The negative assertion below references the full secret value (TEST_PASSWORD) rather
// than the bare fragment (SECRETS.FRAGMENT) because haibun loads every feature source
// up front and includes it in standalone-report events. The redaction pass replaces
// every occurrence of each known secret value with OBSCURED_VALUE everywhere in the
// rendered HTML — so the full secret string ALSO disappears from this assertion's own
// step text once redacted, but the bare fragment ("ISECRET_") would remain literal
// here and trigger a false-positive leak. Checking the full value is the right level
// of strictness: a real leak would surface as the value, not as the fragment alone.
export const features: TKirejiExport = {
	"Verify No Secrets in Shu Standalone Output": [
		`Scenario: Check the standalone output obscures secrets
    storage entry "/tmp/shu-audit.html" exists
    file "/tmp/shu-audit.html" is recent within 2 minutes

    The obscured marker must be present first — it proves a secret was found and redacted, so the next check is not passing merely because nothing was there.
    text at "/tmp/shu-audit.html" contains "${OBSCURED_VALUE}"
    And the raw secret value must be absent from the output.
    not text at "/tmp/shu-audit.html" contains "${SECRETS.TEST_PASSWORD}"
    `,
	],
};
