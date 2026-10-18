/** A screenshot of the page, saved into actuality's storage as an image artifact of the step it shows. */
import { pathToFileURL } from "node:url";
import type { TImageReference } from "@haibun/core/lib/domains/media-object.js";
import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import { artifactAddress } from "@haibun/core/lib/domains/run-artifact.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import type { TStepResult } from "@haibun/core/lib/domains/protocol.js";
import type { AStorage } from "@haibun/domain-storage/domains/storage.js";
import { saveImageArtifact } from "@haibun/domain-storage/pipelines/image-artifact.js";
import type { BrowserSession } from "./browser-session.js";

/** The media type of a saved screenshot. */
const SCREENSHOT_FORMAT = MEDIA_TYPE.png;

/** The step a screenshot shows, whose position names its artifact. */
export type TScreenshotStep = Pick<TStepResult, "seqPath" | "in" | "path">;

/** Screenshots the page into actuality's storage, and returns the address actuality serves it at, logging where it was saved. */
export async function captureScreenshot(session: BrowserSession, world: TWorld, storage: AStorage, event: string, step: TScreenshotStep): Promise<TImageReference> {
	const filename = `event-${step.seqPath.join(".")}.png`;
	const buffer = await session.withPage((page) => page.screenshot());
	const saved = await saveImageArtifact(world, storage, { seqPath: step.seqPath, in: step.in, source: { path: step.path } }, filename, buffer, SCREENSHOT_FORMAT);
	world.eventLogger.debug(`${event} screenshot to ${pathToFileURL(saved.absolutePath)}`);
	return { contentUrl: artifactAddress(saved.baseRelativePath), encodingFormat: SCREENSHOT_FORMAT };
}
