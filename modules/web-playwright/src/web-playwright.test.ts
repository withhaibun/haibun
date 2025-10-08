import { describe, it, expect } from 'vitest';
import path from 'path';

import StorageMem from '@haibun/storage-mem';
import WebPlaywright from './web-playwright.js';
import { getPackageLocation } from '@haibun/core/lib/util/workspace-lib.js';

import { getCreateSteppers, getDefaultWorld } from '@haibun/core/lib/test/lib.js';
import { AStepper } from '@haibun/core/lib/astepper.js';
import { TAnyFixme } from '@haibun/core/lib/fixme.js';

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

describe.skip('handles cycles', () => {
	it('closes browser', async () => {
		const wp = new WebPlaywright();
		wp.storage = new StorageMem();
		// minimal world so capture directory logic has context
		// cast to satisfy AStepper array without redefining full type expectations in test
		// Provide wp in steppers array with correct structural type
		await wp.setWorld(getDefaultWorld(0), [wp as unknown as AStepper as TAnyFixme]);
		await wp.steps.takeScreenshot.action();
		expect(async () => {
			if (wp.cycles && wp.cycles.endFeature) {

				const world = getDefaultWorld(0);
				await wp.cycles.endFeature({ world, shouldClose: true, isLast: true, okSoFar: true, continueAfterError: false, stayOnFailure: false, thisFeatureOK: true });
				await wp.steps.takeScreenshot.action();
			} else {
				throw new Error('no cycles');
			}
		}).not.toThrow();
	});
})
