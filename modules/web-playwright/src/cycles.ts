import { rmSync } from "fs";
import { relative, resolve } from "path";

import {
	IObservationSource,
	IStepperCycles,
	TFailureArgs,
	TEndFeature,
	TStartExecution,
	TResolvedFeature,
	TStartFeature,
	TStepAction,
	type TBeforeStep,
	type TAfterStep,
	type TAfterStepResult,
} from "@haibun/core/lib/astepper.js";
import { queryFacts } from "@haibun/core/lib/working-memory.js";
import { HTTP_REQUEST_LABEL, HTTP_HOST_LABEL } from "@haibun/core/lib/http-observations.js";

import { VideoArtifact } from "@haibun/core/schema/protocol.js";
import { EMediaTypes } from "@haibun/domain-storage/media-types.js";
import { WebPlaywright } from "./web-playwright.js";
import { WebPlaywrightDomains, VISITED_PAGE_LABEL } from "./domains.js";

// HTTP trace observation sources read the persisted records the network sequence also reads.
const httpTraceSources: IObservationSource[] = [
	{
		name: "http-trace hosts",
		observe: async (world) => {
			// Each persisted HttpHost record carries how many requests reached it.
			const quads = await queryFacts(world, "requestCount", HTTP_HOST_LABEL);
			const items = quads.map((q) => q.subject);
			const metrics: Record<string, Record<string, unknown>> = {};
			for (const q of quads) metrics[q.subject] = { count: q.object };
			return { items, metrics };
		},
	},
	{
		name: "http-trace",
		observe: async (world) => {
			// Each persisted http-request record with its full fields (status, durationMs, url, …): the same nodes the
			// polymorphic network sequence reads, so a quantifier can assert e.g. `request/status is less than 400`.
			const quads = await world.shared.getStore().query({ namedGraph: HTTP_REQUEST_LABEL });
			const metrics: Record<string, Record<string, unknown>> = {};
			for (const q of quads) (metrics[q.subject] ??= {})[q.predicate] = q.object;
			return { items: Object.keys(metrics), metrics };
		},
	},
	{
		name: "visited pages",
		observe: async (world) => {
			// Each persisted VisitedPage record, ordered by visit time (generatedAtTime).
			const quads = await queryFacts(world, "name", VISITED_PAGE_LABEL);
			const ordered = [...quads].sort((a, b) => a.timestamp - b.timestamp);
			const items = ordered.map((q) => q.object as string);
			const metrics: Record<string, Record<string, unknown>> = {};
			for (let i = 0; i < items.length; i++) metrics[items[i]] = { index: i };
			return { items, metrics };
		},
	},
];

export const cycles = (wp: WebPlaywright): IStepperCycles => ({
	getConcerns: () => ({ domains: WebPlaywrightDomains, sources: httpTraceSources }),
	async onFailure({ failedStep }: TFailureArgs): Promise<void> {
		if (wp.bf?.hasPage(wp.getWorld().tag, wp.tab)) {
			await wp.captureFailureScreenshot("failure", failedStep);
		}
	},
	beforeStep(_args: TBeforeStep): Promise<void> {
		wp.errorMark = wp.browserErrors.length;
		return Promise.resolve();
	},
	afterStep({ featureStep }: TAfterStep): Promise<TAfterStepResult> {
		const newErrors = wp.browserErrors.slice(wp.errorMark);
		if (newErrors.length === 0) return Promise.resolve({ failed: false });
		// A browser-side uncaught exception during this step is a real failure, surface it loudly instead of
		// letting a later wait time out with no explanation.
		wp.getWorld().eventLogger.log(featureStep, "error", `uncaught browser error during step: ${newErrors.join(" | ")}`);
		return Promise.resolve({ failed: true });
	},
	async startExecution(resolvedFeatures: TStartExecution): Promise<void> {
		if (wp.twin) {
			await wp.createTwin();
		}
	},

	async startFeature({ resolvedFeature, index }: TStartFeature): Promise<void> {
		wp.tab = 0;
		wp.browserErrors = []; // browser-error capture is per-feature
		wp.resetVideoStartEmitted(); // Reset for new feature's video recording
		// Reset API state to prevent header leakage between features
		wp.extraHTTPHeaders = {};
		wp.apiUserAgent = undefined;

		if (wp.twinPage) {
			wp.twinPage.updateWorld(wp.getWorld());
		}
		await writeFeaturesArtifact(wp, `feature-${index}`, [resolvedFeature]);
	},
	async endFeature({ shouldClose = true }: TEndFeature) {
		// leave web server running if there was a failure or it's the last feature
		if (shouldClose) {
			await closeAfterFeature(wp);
		}
		if (wp.twin) {
			await wp.twinPage.writePage();
		}
	},
	async endExecution() {
		// empty
	},
});

async function writeFeaturesArtifact(wp: WebPlaywright, type: string, resolvedFeatures: TResolvedFeature[]) {
	const filename = `${type}.json`;
	const contents = JSON.stringify(resolvedFeatures, null, 2);
	await wp.storage.saveArtifact(filename, contents, EMediaTypes.json, "json");
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
			// const match = featureRelPath.match(/^featn-\d+(?:-.*)?\/(.*)$/);
			// const path = match ? './' + match[1] : './' + featureRelPath;

			// Emit video artifact event (with isTimeLined for timeline sync)
			// VideoStartArtifact is emitted in getPage() when recording starts
			const featureStep = {
				seqPath: [world.tag.featureNum, 0, 0],
				source: { path: world.runtime.feature || "feature" },
				in: "feature video",
				action: {} as TStepAction,
			};

			const videoEvent = VideoArtifact.parse({
				id: `feat-${world.tag.featureNum}.video`,
				timestamp: Date.now(),
				kind: "artifact",
				artifactType: "video",
				path: featureRelPath, // Use base-relative for live, transformed for serialized
				mimetype: "video/webm",
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
