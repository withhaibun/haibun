/** A feature's end: its downloads removed, its video recorded as an artifact, and its context and browser closed. */
import type { TResolvedFeature } from "@haibun/core/lib/astepper.js";
import { featureAsData } from "@haibun/core/lib/features.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { VideoArtifact } from "@haibun/core/schema/protocol.js";
import type { AStorage } from "@haibun/domain-storage/AStorage.js";
import { relative, resolve } from "node:path";
import type { TFiles } from "../ports.js";
import { featureStepOf, type BrowserSession } from "./browser-session.js";

export type TFeatureEnd = { session: BrowserSession; world: TWorld; storage: AStorage; files: TFiles; captureVideo: boolean };

/** Writes the feature as it resolved, as a JSON artifact of the feature's position. */
export async function writeFeatureArtifact(storage: AStorage, index: number, feature: TResolvedFeature): Promise<void> {
	await storage.saveArtifact(`feature-${index}.json`, JSON.stringify([featureAsData(feature)], null, 2), "json");
}

/** Ends the feature's browsing: removes its downloads, records the page's video where actuality captures one, and closes the context and browser. */
export async function endFeature({ session, world, storage, files, captureVideo }: TFeatureEnd): Promise<void> {
	for (const file of session.downloaded) {
		world.eventLogger.debug(`removing ${JSON.stringify(file)}`);
		files.remove(file);
	}
	session.downloaded = [];
	if (session.pages === undefined) return;
	if (captureVideo) {
		const video = (await session.page()).video();
		if (!video) throw new Error("a feature that captures video records each page, and this page lacks a recording");
		// The path is relative to the feature's capture directory, the base of the serialized report's paths.
		const path = relative(resolve(storage.getArtifactBasePath()), await video.path());
		const { featureNum } = world.tag;
		const artifact = VideoArtifact.parse({
			id: `feat-${featureNum}.video`,
			timestamp: Date.now(),
			kind: "artifact",
			artifactType: "video",
			path,
			mimetype: "video/webm",
			isTimeLined: true,
		});
		world.eventLogger.artifact(featureStepOf(featureNum, "feature video"), artifact);
	}
	await session.close();
}
