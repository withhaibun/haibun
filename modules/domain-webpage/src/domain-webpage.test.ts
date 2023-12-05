import { describe, it, expect } from 'vitest';

import { onCurrentTypeForDomain } from '@haibun/core/build/steps/vars.js';
import { AStepper, TNamed, IRequireDomains } from '@haibun/core/build/lib/defs.js';
import { runWith } from '@haibun/core/build/lib/run.js';
import { asFeatures, getDefaultWorld } from '@haibun/core/build/lib/test/lib.js';
import { actionOK, getDefaultOptions } from '@haibun/core/build/lib/util/index.js';
import DomainWebPage, { WEB_CONTROL, WEB_PAGE } from './domain-webpage.js';

const TestStepsRequiresDomain = class TestStepsRequiresDomain extends AStepper implements IRequireDomains {
  requireDomains = [WEB_PAGE, WEB_CONTROL];
  steps = {
    onType: {
      gwta: `on the {name} {type}$`,
      action: async ({ name, type }: TNamed) => {
        const location = onCurrentTypeForDomain({ name, type: WEB_PAGE }, this.getWorld());
        return actionOK(location);
      },
    },
    test: {
      gwta: `Press the {what: ${WEB_CONTROL}}`,
      action: async (named: TNamed) => {
        return actionOK();
      },
    },
  };
};

describe('domain webpage', () => {
  it('domain object from background', async () => {
    const specl = getDefaultOptions();
    const key = '/backgrounds/p1';

    const { world } = getDefaultWorld(0);
    const features = asFeatures([{ path: '/features/test.feature', content: `Backgrounds: p1.${WEB_PAGE}\n\nOn the ${key} ${WEB_PAGE}\nPress the submit button` }]);
    const backgrounds = asFeatures([{ path: `/backgrounds/p1.${WEB_PAGE}.feature`, content: '' }]);
    const result = await runWith({ specl, features, backgrounds, addSteppers: [TestStepsRequiresDomain, DomainWebPage], world });

    expect(result.ok).toBe(true);

    // FIXME wrong result
    expect(result.featureResults[0].stepResults[0].actionResults[0].topics).toEqual("http://localhost:8123//backgrounds/p1");
  });
});
