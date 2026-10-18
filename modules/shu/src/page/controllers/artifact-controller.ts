/**
 * Determines the address of an artifact of actuality. A served page reads it from actuality's artifact route. A page
 * opened as a file reads it from the file's own directory, since the report is written into the feature's directory. A
 * view that shows an artifact passes its record or address. This module determines the address for either kind of page.
 */
import { nothing } from "lit";
import { until } from "lit/directives/until.js";
import { isOffline } from "./hydration-controller.js";
import { readArtifact } from "../root.js";
import { ARTIFACTS_ROUTE } from "@haibun/core/lib/domains/run-artifact.js";
import { artifactAddressOf, type TArtifactRecord } from "../derivations/artifact-url.js";
import { reportToRun } from "./client-log-controller.js";
import { errorDetail } from "@haibun/core/lib/domains/util.js";

/** Returns the address of one artifact from the event's record of it, for the kind of page this page is. */
export const artifactUrl = (artifact: TArtifactRecord): string | undefined => artifactAddressOf(artifact, isOffline());

/** Maps each artifact address to its read from actuality. A read resolves to the object URL a view shows. */
const shown = new Map<string, Promise<string>>();

/**
 * Returns the address where a view shows an artifact. Actuality serves its artifacts only to a caller that holds a
 * private read. It reads an address on actuality's artifact route with the page's delegation and returns an object URL of
 * the content. A later call for that address returns the same object URL. It returns the address unchanged for a page
 * opened as a file and for an address outside the artifact route.
 */
export function shownArtifact(url: string): Promise<string> {
	if (isOffline() || !url.startsWith(`${ARTIFACTS_ROUTE}/`)) return Promise.resolve(url);
	const reading = shown.get(url) ?? readArtifact(url);
	shown.set(url, reading);
	// A failed read is deleted from `shown`, so the next shownArtifact call reads the artifact again. The caller receives
	// the failure.
	void Promise.allSettled([reading]).then(([read]) => {
		if (read?.status === "rejected") shown.delete(url);
	});
	return reading;
}

/** Returns the address where a view shows an artifact. It reports the reason for a failed read to actuality and returns
 *  undefined. */
export const shownOrReported = (url: string, source: string): Promise<string | undefined> =>
	shownArtifact(url).catch((err: unknown) => {
		reportToRun("warn", source, `an artifact couldn't be shown: ${errorDetail(err)}`, { url });
		return undefined;
	});

/** Returns a lit directive that binds an artifact's address once the page has read it. It renders lit's `nothing` while
 *  the read is pending and after a failed read. */
export const artifactAt = (url: string, source: string) =>
	until(
		shownOrReported(url, source).then((at) => at ?? nothing),
		nothing,
	);
