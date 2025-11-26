import { resolve } from 'path';

import { IStepperCycles, TFailureArgs, TEndFeature, TStepResult } from '@haibun/core/lib/defs.js';
import { EExecutionMessageType, TArtifactImage, TMessageContext } from '@haibun/core/lib/interfaces/logger.js';
import { EMediaTypes } from '@haibun/domain-storage/media-types.js';
import type Mobile from './haibun-mobile-stepper.js';
import { MobileDomains } from './domains.js';

export const cycles = (mobile: Mobile): IStepperCycles => ({
	getDomains: () => MobileDomains,

	async onFailure({ failedStep }: TFailureArgs): Promise<void> {
		if (mobile.driverFactory?.hasDriver(String(mobile.getWorld().tag))) {
			await mobile.captureFailureScreenshot(EExecutionMessageType.ON_FAILURE, failedStep);
		}
	},

	async endFeature({ shouldClose = true }: TEndFeature): Promise<void> {
		if (shouldClose && mobile.hasFactory) {
			const tag = String(mobile.getWorld().tag);

			if (mobile.driverFactory) {
				await mobile.driverFactory.closeDriver(tag);
			}

			mobile.getWorld().logger.info('Feature completed - driver closed');
		}
	},

	async endExecution(): Promise<void> {
		if (mobile.driverFactory) {
			mobile.getWorld().logger.info('Stopping mobile test execution');
			await mobile.driverFactory.closeAll();
			mobile.hasFactory = false;
		}
	},

	async startScenario(): Promise<void> {
		const tag = String(mobile.getWorld().tag);
		if (mobile.driverFactory?.hasDriver(tag)) {
			const resetBehavior = mobile.resetBehavior;

			if (resetBehavior === 'reset') {
				await mobile.driverFactory.resetApp(tag);
			} else if (resetBehavior === 'relaunch') {
				await mobile.driverFactory.relaunchApp(tag);
			}
		}
	},
});

export async function captureScreenshot(mobile: Mobile, event: EExecutionMessageType, details: { seq?: number; step?: TStepResult }): Promise<{ context: TMessageContext; path: string }> {
	const loc = await mobile.getCaptureDir('image');
	const path = resolve(mobile.storage!.fromLocation(EMediaTypes.image, loc, `${event}-${Date.now()}.png`));

	const driver = await mobile.getDriver();
	await driver.saveScreenshot(path);

	const artifact: TArtifactImage = {
		artifactType: 'image',
		path: await mobile.storage!.getRelativePath(path),
	};

	const context: TMessageContext = {
		incident: EExecutionMessageType.ACTION,
		artifacts: [artifact],
		tag: mobile.getWorld().tag,
		incidentDetails: { ...details, event },
	};

	return { context, path };
}
