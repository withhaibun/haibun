import { rmSync } from 'fs';
import { resolve } from 'path/posix';
import { pathToFileURL } from 'url';

import { IStepperCycles, TFailureArgs, TEndFeature, TStartExecution } from '@haibun/core/build/lib/defs.js';
import { EExecutionMessageType, TArtifactVideo, TArtifactMermaid, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';
import { generateMermaidGraph } from './monitor/graph/generateMermaidGraph.js';
import { WebPlaywright, EMonitoringTypes } from './web-playwright.js';

export const cycles = (wp: WebPlaywright): IStepperCycles => ({
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async onFailure({ failedStep }: TFailureArgs): Promise<void> {
		if (wp.bf?.hasPage(wp.getWorld().tag, wp.tab)) {
			await wp.captureFailureScreenshot(EExecutionMessageType.ON_FAILURE, failedStep);
		}
	},
	async startFeature(): Promise<void> {
		if (wp.monitor === EMonitoringTypes.MONITOR_EACH) {
			await wp.createMonitor();
		}
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
	async startExecution(features: TStartExecution): Promise<void> {
		if (wp.monitor === EMonitoringTypes.MONITOR_ALL) {
			await wp.createMonitor();
		}
		const mediaType = EMediaTypes.html;
		const mermaidGraph = await generateMermaidGraph(features);
		const path = resolve(wp.storage.fromLocation(mediaType, `feature-graph.mermaid`));
		const artifact: TArtifactMermaid = { artifactType: 'mermaid', path };
		const context: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			artifact,
			tag: wp.getWorld().tag,
		};
		wp.getWorld().logger.info(`mermaid graph for features written to ${pathToFileURL(path)}`, context);
		await wp.storage.writeFile(path, mermaidGraph.join('\n'), mediaType);
	},

	async endExecution() {
		if (wp.monitor === EMonitoringTypes.MONITOR_ALL) {
			await wp.callClosers();
			await WebPlaywright.monitorHandler.writeMonitor();
		}
	},
});
