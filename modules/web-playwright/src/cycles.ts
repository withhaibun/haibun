import { rmSync, readFileSync } from 'fs';
import { relative, resolve } from 'path';

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
	const filename = `${type}.json`;
	const contents = JSON.stringify(resolvedFeatures, null, 2);
	await wp.storage.saveArtifact(filename, contents, EMediaTypes.json, 'json');
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
			const videoPath = await page.video().path();
			// Compute path relative to feature capture dir for serialized HTML
			const basePath = wp.storage.getArtifactBasePath();
			const featureRelPath = relative(resolve(basePath), videoPath);
			// For artifact, use feature-relative path (strip seq-N/featn-N prefix)
			const match = featureRelPath.match(/^seq-\d+\/featn-\d+\/(.*)$/);
			const path = match ? './' + match[1] : './' + featureRelPath;

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

