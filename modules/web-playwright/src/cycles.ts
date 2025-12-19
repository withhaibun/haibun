import { rmSync, readFileSync } from 'fs';
import { relative, resolve } from 'path';

import { IStepperCycles, TFailureArgs, TEndFeature, TStartExecution, TResolvedFeature, TStartFeature } from '@haibun/core/lib/defs.js';

import { VideoArtifact } from '@haibun/core/schema/protocol.js';
import { EMediaTypes } from '@haibun/domain-storage/media-types.js';
import { WebPlaywright } from './web-playwright.js';
import { WebPlaywrightDomains } from './domains.js';

export const cycles = (wp: WebPlaywright): IStepperCycles => ({
	getDomains: () => WebPlaywrightDomains,
	// biome-disable-next-line @typescript-eslint/no-unused-vars
	async onFailure({ failedStep }: TFailureArgs): Promise<void> {
		if (wp.bf?.hasPage(wp.getWorld().tag, wp.tab)) {
			await wp.captureFailureScreenshot('failure', failedStep);
		}
	},
	async startExecution(resolvedFeatures: TStartExecution): Promise<void> {
		if (wp.twin) {
			await wp.createTwin();
		}
	},

	async startFeature({ resolvedFeature, index }: TStartFeature): Promise<void> {
		wp.tab = 0;
		wp.resetVideoStartEmitted(); // Reset for new feature's video recording

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
	},
	async endExecution() {
	},
});

async function writeFeaturesArtifact(wp: WebPlaywright, type: string, resolvedFeatures: TResolvedFeature[]) {
	const filename = `${type}.json`;
	const contents = JSON.stringify(resolvedFeatures, null, 2);
	await wp.storage.saveArtifact(filename, contents, EMediaTypes.json, 'json');
}

async function closeAfterFeature(wp: WebPlaywright) {
	for (const file of wp.downloaded) {
		wp.getWorld().eventLogger.debug(`removing ${JSON.stringify(file)}`);
		rmSync(file);
		wp.downloaded = [];
	}
	if (wp.hasFactory) {
		if (wp.captureVideo) {
			const page = await wp.getPage();
			const videoPath = await page.video().path();
			const world = wp.getWorld();
			// Compute path relative to feature capture dir for serialized HTML
			const basePath = wp.storage.getArtifactBasePath();
			const featureRelPath = relative(resolve(basePath), videoPath);
			// For artifact, use feature-relative path (strip featn-N prefix)
			const match = featureRelPath.match(/^featn-\d+(?:-.*)?\/(.*)$/);
			const path = match ? './' + match[1] : './' + featureRelPath;

			// Emit video artifact event (with isTimeLined for timeline sync)
			// VideoStartArtifact is emitted in getPage() when recording starts
			const featureStep = {
				seqPath: [world.tag.featureNum, 0, 0],
				path: world.runtime.feature || 'feature',
				in: 'feature video',
				action: {} as any,
			};

			const videoEvent = VideoArtifact.parse({
				id: `feat-${world.tag.featureNum}.video`,
				timestamp: Date.now(),
				kind: 'artifact',
				artifactType: 'video',
				path: featureRelPath, // Use base-relative for live, transformed for serialized
				mimetype: 'video/webm',
				isTimeLined: true,
			});
			world.eventLogger.artifact(featureStep, videoEvent);
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

