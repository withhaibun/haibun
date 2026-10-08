/**
 * saveImageArtifact writes a step's image to storage. It emits an image artifact event through the world's event logger.
 * The event holds the image's path for a served page and its path for the serialized report. WebPlaywright.captureScreenshot
 * and the shu "save a graph still" step call this function, so the artifact id scheme and the event's fields are defined once.
 */
import type { TWorld } from "@haibun/core/lib/world.js";
import type { AStorage, TSavedArtifact } from "./AStorage.js";
import { ImageArtifact } from "@haibun/core/schema/protocol.js";
import type { TFeatureStep } from "@haibun/core/lib/astepper.js";

export async function saveImageArtifact(
	world: TWorld,
	storage: AStorage,
	featureStep: Pick<TFeatureStep, "seqPath" | "in"> & { source?: { path?: string } },
	filename: string,
	contents: string | Buffer,
	mimetype: string,
): Promise<TSavedArtifact> {
	const saved = await storage.saveArtifact(filename, contents, "image");
	// A served page reads the image at baseRelativePath under the /artifacts route. Storage saves the serialized report to
	// the feature dir as shu.html. That report reads the image at featureRelativePath ("./image/x.png").
	const artifact = ImageArtifact.parse({
		id: `${featureStep.seqPath.join(".")}.artifact.0`,
		timestamp: Date.now(),
		kind: "artifact",
		artifactType: "image",
		path: saved.baseRelativePath,
		featureRelativePath: saved.featureRelativePath,
		mimetype,
	});
	world.eventLogger.artifact(featureStep as TFeatureStep, artifact);
	return saved;
}
