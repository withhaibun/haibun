/**
 * Each artifact a step saves goes through this path into actuality: storage saves it, and the artifact stream that the
 * report and the live /artifacts route read announces it. An image, a screenshot or a graph still, and a file a person
 * adds, each takes it, so the artifact id scheme and field set exist once.
 */
import type { TWorld } from "@haibun/core/lib/world.js";
import type { AStorage, TSavedArtifact } from "./AStorage.js";
import { EMediaTypes } from "./media-types.js";
import { FileArtifact, ImageArtifact } from "@haibun/core/schema/protocol.js";
import { KEPT_FILES_FOLDER } from "@haibun/core/lib/run-artifact.js";
import type { TFeatureStep } from "@haibun/core/lib/astepper.js";

type TSavingStep = Pick<TFeatureStep, "seqPath" | "in"> & { source?: { path?: string } };

/** Save a file a person adds to the kept folder of actuality's artifacts. */
export async function saveKeptFile(world: TWorld, storage: AStorage, featureStep: TSavingStep, filename: string, contents: Buffer, mimetype: string): Promise<TSavedArtifact> {
	const saved = await storage.saveArtifact(filename, contents, EMediaTypes.file, KEPT_FILES_FOLDER);
	const artifact = FileArtifact.parse({ ...artifactEventBase(featureStep), artifactType: "file", path: saved.baseRelativePath, mimetype });
	world.eventLogger.artifact(featureStep as TFeatureStep, artifact);
	return saved;
}

/** The fields every artifact event carries. */
const artifactEventBase = (featureStep: TSavingStep) => ({ id: `${featureStep.seqPath.join(".")}.artifact.0`, timestamp: Date.now(), kind: "artifact" as const });

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
		...artifactEventBase(featureStep),
		artifactType: "image",
		path: saved.baseRelativePath,
		featureRelativePath: saved.featureRelativePath,
		mimetype,
	});
	world.eventLogger.artifact(featureStep as TFeatureStep, artifact);
	return saved;
}
