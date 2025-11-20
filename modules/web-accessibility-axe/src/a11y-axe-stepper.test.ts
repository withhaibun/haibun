import { describe, it, expect, afterAll } from 'vitest';
import { pathToFileURL } from 'url';

import { passWithDefaults } from '@haibun/core/lib/test/lib.js';
import A11yAxe from './a11y-axe-stepper.js';
import { DEFAULT_DEST, TOKActionResult } from '@haibun/core/lib/defs.js';
import { getStepperOptionName } from '@haibun/core/lib/util/index.js';
import { BrowserFactory } from '@haibun/web-playwright/BrowserFactory.js';

import StorageMem from '@haibun/storage-mem/storage-mem.js';
import WebPlaywright from '@haibun/web-playwright';

const PASSES_URI = pathToFileURL('./files/test/passes.html');
const FAILS_URI = pathToFileURL('./files/test/fails.html');

const options = {
  DEST: DEFAULT_DEST
};
const moduleOptions = {
  [getStepperOptionName(WebPlaywright, 'STORAGE')]: 'StorageMem',
  [getStepperOptionName(A11yAxe, 'STORAGE')]: 'StorageMem',
  [getStepperOptionName(WebPlaywright, 'HEADLESS')]: 'true'
}

afterAll(async () => {
  await BrowserFactory.closeBrowsers();
});

describe('a11y test from uri', () => {
  it('passes', async () => {
    const features = [{
      path: '/features/test.feature', content: `
Go to the ${PASSES_URI} webpage
page is accessible accepting serious 0 and moderate 2
`}];

    const res = await passWithDefaults(features, [A11yAxe, WebPlaywright, StorageMem], { options, moduleOptions });
    expect(res.ok).toBe(true);
    const fr = res.featureResults![0]!.stepResults!;
    expect(fr[0]).toBeDefined();
    expect(fr[0]?.ok).toBe(true);
    expect(fr[1]).toBeDefined();
    expect(fr[1]?.ok).toBe(true);
  });
  it('fails', async () => {
    const features = [{
      path: '/features/test.feature', content: `
Go to the ${FAILS_URI} webpage
page is accessible accepting serious 0 and moderate 0
`}];

    const res = await passWithDefaults(features, [A11yAxe, WebPlaywright, StorageMem], { options, moduleOptions });
    expect(res.ok).toBe(false);
    const fr = res.featureResults![0]!.stepResults!;
    expect(fr[0]).toBeDefined();
    expect(fr[0]?.ok).toBe(true);
    expect(fr[1]).toBeDefined();
    expect(fr[1]?.ok).toBe(false);
    expect((<TOKActionResult>res.featureResults![0]!.stepResults![1]?.stepActionResult)?.artifact).toBeDefined();
  });
});
