import { describe, it, expect } from 'vitest';
import path from 'path';

import WebPlaywright from './web-playwright.js';
import { getPackageLocation } from '@haibun/core/build/lib/util/workspace-lib.js';

import { getCreateSteppers, getDefaultWorld, testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import { DEFAULT_DEST, TFeatureStep } from '@haibun/core/build/lib/defs.js';
import { getStepperOptionName } from '@haibun/core/build/lib/util/index.js';

const me = path.join(getPackageLocation(import.meta).replace(/\/src$/, '/build'), 'web-playwright');

describe('playwrightWeb', () => {
	it('sets up steps', async () => {
		const steppers = await getCreateSteppers([me]);
		expect(Object.keys(steppers[0].steps).length > 0).toBe(true);
		expect(Object.values(steppers[0].steps).every((s) => !!s.action)).toBe(true);
	});
	/*
	it('sets browser type and device', async () => {
		const { world, featureStep, steppers } = await getTestEnv([me], 'using firefox.Pixel 5 browser', getDefaultWorld(0));
		await FeatureExecutor.doFeatureStep(steppers, featureStep, world);
		const webPlaywright = findStepper<any>(steppers, 'WebPlaywright');
		const bf = await webPlaywright.getBrowserFactory();

		expect(bf.browserType.name()).toBe('firefox');
		expect(bf.device).toBe('Pixel 5');
	});
	it('fails setting browser type and device', async () => {
		const { world, featureStep, steppers } = await getTestEnv([me], 'using nonexistent browser', getDefaultWorld(0));
		const result = await FeatureExecutor.doFeatureStep(steppers, featureStep, world);
		expect(result.actionResult.ok).toBe(false);
	});
	*/
});

describe('handles cycles', () => {
	it('closes browser', async () => {
		const wp = new WebPlaywright();
		await wp.steps.takeScreenshot.action({}, {} as TFeatureStep);
		expect(async () => {
			if (wp.cycles && wp.cycles.endFeature) {

				const world = getDefaultWorld(0);
				await wp.cycles.endFeature({ world, shouldClose: true, isLast: true, okSoFar: true, continueAfterError: false, stayOnFailure: false, thisFeatureOK: true });
				await wp.steps.takeScreenshot.action({}, {} as TFeatureStep);
			} else {
				throw new Error('no cycles');
			}
		}).not.toThrow();
	});
})

describe('options', () => {
	it('sets headless', async () => {
		const feature = { path: '/features/test.feature', content: `set "what" to "var"\nset x to {what}` };
		const result = await testWithDefaults([feature], [WebPlaywright, ], {
			options: { DEST: DEFAULT_DEST, },
			moduleOptions: {
				[getStepperOptionName(WebPlaywright, 'PORT')]: '8124',
			},
		});
	});
});
