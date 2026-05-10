import { rmSync } from "fs";
import { relative, resolve } from "path";

import { IObservationSource, IStepperCycles, TFailureArgs, TEndFeature, TStartExecution, TResolvedFeature, TStartFeature, TStepAction } from "@haibun/core/lib/astepper.js";
import { OBSERVATION_GRAPH, queryFacts } from "@haibun/core/lib/working-memory.js";

import { VideoArtifact } from "@haibun/core/schema/protocol.js";
import { EMediaTypes } from "@haibun/domain-storage/media-types.js";
import { WebPlaywright } from "./web-playwright.js";
import { WebPlaywrightDomains } from "./domains.js";

// Observation source for the visited-pages list. Append-only so we use a synthetic
// per-page subject ordered by insertion timestamp; identity-as-position lets the
// quantifier output preserve navigation order.
const VISITED_PAGES_GRAPH = "observation/visited-page";

// HTTP trace observation sources read from the quad store under the observation/* graphs.
const httpTraceSources: IObservationSource[] = [
	{
		name: "http-trace hosts",
		observe: async (world) => {
			const quads = await queryFacts(world, "count", OBSERVATION_GRAPH.HTTP_HOST);
			const items = quads.map((q) => q.subject);
			const metrics: Record<string, Record<string, unknown>> = {};
			for (const q of quads) metrics[q.subject] = { count: q.object };
			return { items, metrics };
		},
	},
	{
		name: "http-trace",
		observe: async (world) => {
			const quads = await queryFacts(world, "observation", OBSERVATION_GRAPH.HTTP_REQUEST);
			const items = quads.map((q) => q.subject);
			const metrics: Record<string, Record<string, unknown>> = {};
			for (const q of quads) metrics[q.subject] = q.object as Record<string, unknown>;
			return { items, metrics };
		},
	},
	{
		name: "visited pages",
		observe: async (world) => {
			const quads = await queryFacts(world, "url", VISITED_PAGES_GRAPH);
			const ordered = [...quads].sort((a, b) => a.timestamp - b.timestamp);
			const items = ordered.map((q) => q.object as string);
			const metrics: Record<string, Record<string, unknown>> = {};
			for (let i = 0; i < items.length; i++) metrics[items[i]] = { index: i };
			return { items, metrics };
		},
	},
];

export const VISITED_PAGES_OBSERVATION_GRAPH = VISITED_PAGES_GRAPH;

export const cycles = (wp: WebPlaywright): IStepperCycles => ({
	getConcerns: () => ({ domains: WebPlaywrightDomains, sources: httpTraceSources }),
	async onFailure({ failedStep }: TFailureArgs): Promise<void> {
		if (wp.bf?.hasPage(wp.getWorld().tag, wp.tab)) {
			await wp.captureFailureScreenshot("failure", failedStep);
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
