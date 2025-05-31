import { rmSync } from 'fs';
import { resolve } from 'path/posix';
import { pathToFileURL } from 'url';

import { IStepperCycles, TFailureArgs, TEndFeature, TStartExecution, TResolvedFeature, TStartFeature } from '@haibun/core/build/lib/defs.js';
import { EExecutionMessageType, TArtifactVideo, TArtifactResolvedFeatures, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';
import { WebPlaywright, EMonitoringTypes } from './web-playwright.js';
import { sleep } from '@haibun/core/build/lib/util/index.js';

export const cycles = (wp: WebPlaywright): IStepperCycles => ({
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async onFailure({ failedStep }: TFailureArgs): Promise<void> {
		if (wp.bf?.hasPage(wp.getWorld().tag, wp.tab)) {
			await wp.captureFailureScreenshot(EExecutionMessageType.ON_FAILURE, failedStep);
		}
	},
	async startFeature({ resolvedFeature, index }: TStartFeature): Promise<void> {
		if (wp.monitor === EMonitoringTypes.MONITOR_EACH) {
			await wp.createMonitor();
		}
		await sleep(1000);
		await createResolvedFeaturesArtifact(wp, `feature-${index}`, [resolvedFeature], index);
	},
	async endFeature({ shouldClose = true }: TEndFeature) {
		// leave web server running if there was a failure and it's the last feature
		if (shouldClose) {
			for (const file of wp.downloaded) {
				wp.getWorld().logger.debug(`removing ${JSON.stringify(file)}`);
				rmSync(file);
				wp.downloaded = [];
			}
			if (wp.hasFactory) {
				if (wp.captureVideo) {
					const page = await wp.getPage();
					const path = await wp.storage.getRelativePath(await page.video().path());
					const artifact: TArtifactVideo = { artifactType: 'video', path };
					const context: TMessageContext = {
						incident: EExecutionMessageType.FEATURE_END,
						artifact,
						tag: wp.getWorld().tag
					};
					wp.getWorld().logger.log('feature video', context);
				}
				// close the context, which closes any pages
				if (wp.hasFactory) {
					await wp.bf?.closeContext(wp.getWorld().tag);
				}
				await wp.bf?.close();
				wp.bf = undefined;
				wp.hasFactory = false;
			}
		}
		if (wp.monitor === EMonitoringTypes.MONITOR_EACH) {
			await wp.callClosers();
			await WebPlaywright.monitorHandler.writeMonitor();
		}
	},
	async startExecution(resolvedFeatures: TStartExecution): Promise<void> {
		if (wp.monitor === EMonitoringTypes.MONITOR_ALL) {
			await wp.createMonitor();
		}
		await createResolvedFeaturesArtifact(wp, 'features', resolvedFeatures);

	},

	async endExecution() {
		if (wp.monitor === EMonitoringTypes.MONITOR_ALL) {
			await wp.callClosers();
			await WebPlaywright.monitorHandler.writeMonitor();
		}
	},
});

async function createResolvedFeaturesArtifact(wp: WebPlaywright, type: string, resolvedFeatures: TResolvedFeature[], index = undefined) {
	const loc = await wp.getCaptureDir('image');
	const mediaType = EMediaTypes.json;
	// FIXME shouldn't be fs dependant
	const path = resolve(wp.storage.fromLocation(mediaType, loc, `${type}.json`));
	const artifact: TArtifactResolvedFeatures = { artifactType: 'resolvedFeatures', resolvedFeatures, index, path };
	const context: TMessageContext = {
		incident: EExecutionMessageType.ACTION,
		artifact,
		tag: wp.getWorld().tag,
	};
	await wp.storage.writeFile(path, JSON.stringify(resolvedFeatures, null, 2), mediaType);
	wp.getWorld().logger.info(`resolvedFeatures for ${type} written to ${pathToFileURL(path)}`, context);
}
