import { type TKirejiExport } from '@haibun/core/kireji/withAction.js';
import { OBSCURED_VALUE } from '@haibun/core/lib/feature-variables.js';

import {SECRETS} from './self-test.feature.ts';

export const features: TKirejiExport = {
  'Verify No Secrets in Monitor Output': [
    `Scenario: Check monitor output for obscured passwords
    Read the file into a variable for text checking.
    // read file "/tmp/monitor.html" into monitor source

    Make sure raw passwords don't appear.
    not matches monitor source with *${SECRETS.SNAKE_CASE}*
    not matches monitor source with *${SECRETS.ALL_CAPS}*
    not matches monitor source with *${SECRETS.USER_PASSWORD}*

    Make sure obscuration occured.
    // variable monitor source includes "${OBSCURED_VALUE}"`,
  ]
};
