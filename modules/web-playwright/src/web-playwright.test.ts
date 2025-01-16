import { describe, it, expect } from 'vitest';

import { getPackageLocation } from '@haibun/core/build/lib/util/workspace-lib.js';

import { FeatureExecutor } from '@haibun/core/build/phases/Executor.js';
import { getTestEnv, getDefaultWorld, getCreateSteppers } from '@haibun/core/build/lib/test/lib.js';
import { findStepper } from '@haibun/core/build/lib/util/index.js';
import path from 'path';

const me = path.join(getPackageLocation(import.meta).replace(/\/src$/, '/build'), 'web-playwright');

describe('playwrightWeb', () => {
	it('sets up steps', async () => {
		const steppers = await getCreateSteppers([me]);
		expect(Object.keys(steppers[0].steps).length > 0).toBe(true);
		expect(Object.values(steppers[0].steps).every((s) => !!s.action)).toBe(true);
	});
  /*
  it('sets browser type and device', async () => {
    const { world, vstep, steppers } = await getTestEnv([me], 'using firefox.Pixel 5 browser', getDefaultWorld(0).world);
    await FeatureExecutor.doFeatureStep(steppers, vstep, world);
    const webPlaywright = findStepper<any>(steppers, 'WebPlaywright');
    const bf = await webPlaywright.getBrowserFactory();

    expect(bf.browserType.name()).toBe('firefox');
    expect(bf.device).toBe('Pixel 5');
  });
  it('fails setting browser type and device', async () => {
    const { world, vstep, steppers } = await getTestEnv([me], 'using nonexistent browser', getDefaultWorld(0).world);
    const result = await FeatureExecutor.doFeatureStep(steppers, vstep, world);
    console.log('🤑', JSON.stringify(result, null, 2));
    expect(result.actionResult.ok).toBe(false);
  });
  */
});
