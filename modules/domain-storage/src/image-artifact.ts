/**
 * Each image a step saves goes through this path into actuality: storage saves it, and the artifact stream that the
 * report and the live /artifacts route read announces it. A screenshot and a graph still each take it, so the artifact id
 * scheme and field set exist once.
 */
import type { TWorld } from "@haibun/core/lib/world.js";
import type { AStorage, TSavedArtifact } from "./AStorage.js";
import { EMediaTypes } from "./media-types.js";
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
	const saved = await storage.saveArtifact(filename, contents, EMediaTypes.image, "image");
	// baseRelativePath drives the live /artifacts route; featureRelativePath ("./image/x.png") drives the serialized
	// report, whose shu.html sits in the same feature dir as the image.
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
