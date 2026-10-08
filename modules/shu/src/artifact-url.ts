/**
 * Determines the address of an artifact of actuality. A served page reads it from actuality's artifact route. A page
 * opened as a file reads it from the file's own directory, since the report is written into the feature's directory. A
 * view that shows an artifact passes its record or address. This module determines the address for either kind of page.
 */
import { nothing } from "lit";
import { until } from "lit/directives/until.js";
import { READS_THE_RUNS_ARTIFACTS } from "@haibun/core/lib/actions.js";
import { isOffline } from "./rpc-registry.js";
import { readingHeaders } from "./page-key.js";
import { ARTIFACTS_ROUTE, artifactAddress } from "@haibun/core/lib/run-artifact.js";
import { reportToRun } from "./client-log.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { isWebAddress } from "@haibun/core/lib/document-content.js";

/** Returns a record's address if it is a path or a web address, and undefined for any other scheme. A `javascript:`
 *  address runs in the page. A `data:` address holds a document the record wrote. */
const followable = (address: unknown): string | undefined => (typeof address === "string" && (!URL.canParse(address) || isWebAddress(address)) ? address : undefined);

/** Returns the address of one artifact from the event's record of it: its own URL, its path under actuality, or its
 *  path relative to the feature's directory. A report is written into the feature's directory. */
export function artifactUrl(artifact: { url?: unknown; path?: unknown; featureRelativePath?: unknown }): string | undefined {
	const url = followable(artifact.url);
	const base = artifact.path ? String(artifact.path).replace(/^\.?\//, "") : undefined;
	// A report is written into its feature's directory. The path's leading `featn-N/` segment names that directory, so
	// removing it gives the artifact's address relative to the report.
	const besideTheFile = base ? `./${base.split("/").slice(1).join("/")}` : undefined;
	if (isOffline()) return followable(artifact.featureRelativePath) ?? url ?? besideTheFile;
	return url ?? (base ? artifactAddress(base) : undefined);
}

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
	// A failed read is deleted from `shown`, so the next shownArtifact call reads the artifact again.
	reading.catch(() => shown.delete(url));
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

async function readArtifact(url: string): Promise<string> {
	const response = await fetch(url, { headers: await readingHeaders(url, READS_THE_RUNS_ARTIFACTS), credentials: "include" });
	if (!response.ok) throw new Error(`actuality refused its artifact ${url}: ${response.status} ${await response.text()}`);
	return URL.createObjectURL(await response.blob());
}
