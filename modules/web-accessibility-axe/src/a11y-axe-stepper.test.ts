import { describe, it, expect, afterAll } from 'vitest';

import { failWithDefaults, passWithDefaults } from '@haibun/core/lib/test/lib.js';
import A11yAxe from './a11y-axe-stepper.js';
import { DEFAULT_DEST, TOKActionResult } from '@haibun/core/lib/defs.js';
import { getStepperOptionName } from '@haibun/core/lib/util/index.js';
import { BrowserFactory } from '@haibun/web-playwright/BrowserFactory.js';

import StorageMem from '@haibun/storage-mem/storage-mem.js';
import WebPlaywright from '@haibun/web-playwright';

const PASSES_URI = new URL('../files/test/passes.html', import.meta.url);
const FAILS_URI = new URL('../files/test/fails.html', import.meta.url);

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
page is accessible accepting serious 99 and moderate 90
`}];

		const res = await passWithDefaults(features, [A11yAxe, WebPlaywright, StorageMem], { options, moduleOptions });
		expect(res.ok).toBe(true);
		expect((<TOKActionResult>res.featureResults![0]!.stepResults![0]?.stepActionResult)?.artifact).toBeUndefined();
	});
	it('fails', async () => {
		const features = [{
			path: '/features/test.feature', content: `
Go to the ${FAILS_URI} webpage
page is accessible accepting serious 0 and moderate 0
`}];

		const res = await failWithDefaults(features, [A11yAxe, WebPlaywright, StorageMem], { options, moduleOptions });
		expect(res.ok).toBe(false);
		expect((<TOKActionResult>res.featureResults![0]!.stepResults![1]?.stepActionResult)?.artifact).toBeDefined();
	});
});
