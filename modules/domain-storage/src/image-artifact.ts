/**
 * The one path an artifact a step saves takes into a run: saved through storage, then announced on the artifact stream
 * the report and the live /artifacts route both read. Every producer of an image, a screenshot or a graph still, and
 * every file a person adds, uses this, so the artifact id scheme and field set exist once.
 */
import type { TWorld } from "@haibun/core/lib/world.js";
import type { AStorage, TSavedArtifact } from "./AStorage.js";
import { EMediaTypes } from "./media-types.js";
import { FileArtifact, ImageArtifact } from "@haibun/core/schema/protocol.js";
import { KEPT_FILES_FOLDER } from "@haibun/core/lib/run-artifact.js";
import type { TFeatureStep } from "@haibun/core/lib/astepper.js";

type TSavingStep = Pick<TFeatureStep, "seqPath" | "in"> & { source?: { path?: string } };

/** Keep a file a person adds, in the folder of actuality's artifacts that serves its files so a script one holds doesn't run. */
export async function saveKeptFile(world: TWorld, storage: AStorage, featureStep: TSavingStep, filename: string, contents: Buffer, mimetype: string): Promise<TSavedArtifact> {
	const saved = await storage.saveArtifact(filename, contents, EMediaTypes.file, KEPT_FILES_FOLDER);
	const artifact = FileArtifact.parse({ ...announced(featureStep), artifactType: "file", path: saved.baseRelativePath, mimetype });
	world.eventLogger.artifact(featureStep as TFeatureStep, artifact);
	return saved;
}

const announced = (featureStep: TSavingStep) => ({ id: `${featureStep.seqPath.join(".")}.artifact.0`, timestamp: Date.now(), kind: "artifact" as const });

export async function saveImageArtifact(
	world: TWorld,
	storage: AStorage,
	featureStep: TSavingStep,
	filename: string,
	contents: string | Buffer,
	mimetype: string,
): Promise<TSavedArtifact> {
	const saved = await storage.saveArtifact(filename, contents, EMediaTypes.image, "image");
	// baseRelativePath drives the live /artifacts route; featureRelativePath ("./image/x.png") drives the serialized
	// report, whose shu.html sits in the same feature dir as the image.
	const artifact = ImageArtifact.parse({
		...announced(featureStep),
		artifactType: "image",
		path: saved.baseRelativePath,
		featureRelativePath: saved.featureRelativePath,
		mimetype,
	});
	world.eventLogger.artifact(featureStep as TFeatureStep, artifact);
	return saved;
}
