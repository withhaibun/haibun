import { rmSync } from 'fs';
import { resolve } from 'path/posix';

import { IStepperCycles, TFailureArgs, TEndFeature, TStartExecution, TResolvedFeature, TStartFeature } from '@haibun/core/lib/defs.js';
import { EExecutionMessageType, TArtifactVideo, TMessageContext } from '@haibun/core/lib/interfaces/logger.js';
import { EMediaTypes } from '@haibun/domain-storage/media-types.js';
import { WebPlaywright, EMonitoringTypes } from './web-playwright.js';
import { WebPlaywrightDomains } from './domains.js';

export const cycles = (wp: WebPlaywright): IStepperCycles => ({
	getDomains: () => WebPlaywrightDomains,
	// biome-disable-next-line @typescript-eslint/no-unused-vars
	async onFailure({ failedStep }: TFailureArgs): Promise<void> {
		if (wp.bf?.hasPage(wp.getWorld().tag, wp.tab)) {
			await wp.captureFailureScreenshot(EExecutionMessageType.ON_FAILURE, failedStep);
		}
	},
	async startExecution(resolvedFeatures: TStartExecution): Promise<void> {
		if (wp.monitor) {
			await wp.createMonitor();
			await wp.monitorHandler.createMonitorPage(wp);
		}
		if (wp.twin) {
			await wp.createTwin();
		}
		await writeFeaturesArtifact(wp, 'features', resolvedFeatures);
	},

	async startFeature({ resolvedFeature, index }: TStartFeature): Promise<void> {
		wp.tab = 0;
		if (wp.monitor === EMonitoringTypes.MONITOR_EACH) {
			await wp.callClosers(); // first tab
			await wp.monitorHandler.createMonitorPage(wp);
			await wp.monitorHandler.updateWorld(wp.getWorld());
		}
		if (wp.twinPage) {
			wp.twinPage.updateWorld(wp.getWorld());
		}
		await writeFeaturesArtifact(wp, `feature-${index}`, [resolvedFeature]);
	},
	async endFeature({ shouldClose = true }: TEndFeature) {
		// leave web server running if there was a failure and it's the last feature
		if (shouldClose) {
			await closeAfterFeature(wp);
		}
		if (wp.twin) {
			await wp.twinPage.writePage();
		}
		if (wp.monitor === EMonitoringTypes.MONITOR_EACH) {
			await wp.callClosers();
			await wp.monitorHandler.writeMonitor();
		}
	},
	async endExecution() {
		if (wp.monitor === EMonitoringTypes.MONITOR_ALL) {
			await wp.callClosers();
			await wp.monitorHandler.writeMonitor();
		}
	},
});

async function writeFeaturesArtifact(wp: WebPlaywright, type: string, resolvedFeatures: TResolvedFeature[]) {
	const loc = await wp.getCaptureDir('json');
	const mediaType = EMediaTypes.json;
	// FIXME shouldn't be fs dependant
	const path = resolve(wp.storage.fromLocation(mediaType, loc, `${type}.json`));
	await wp.storage.writeFile(path, JSON.stringify(resolvedFeatures, null, 2), mediaType);
}

async function closeAfterFeature(wp: WebPlaywright) {
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
				artifacts: [artifact],
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
