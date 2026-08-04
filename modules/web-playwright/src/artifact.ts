/**
 * The one path an image artifact takes into a run: saved through storage, then announced on the artifact stream the
 * report and the live /artifacts route both read. Every producer of an image — a screenshot, a graph still — uses
 * this, so the artifact id scheme and field set exist once.
 */
import type { TWorld } from "@haibun/core/lib/world.js";
import type { AStorage, TSavedArtifact } from "@haibun/domain-storage/AStorage.js";
import { EMediaTypes } from "@haibun/domain-storage/media-types.js";
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
