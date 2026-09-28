/**
 * Where an artifact of the run is read from. A served page reads it from the run's artifact route; a page opened as a
 * file reads it beside itself, since the report is written into the feature's own directory. One rule, so a view that
 * shows an artifact states what to show and not where a page came from.
 */
import { nothing } from "lit";
import { until } from "lit/directives/until.js";
import { READS_THE_RUNS_ARTIFACTS } from "@haibun/core/lib/actions.js";
import { isOffline } from "./rpc-registry.js";
import { readingHeaders } from "./page-key.js";
import { ARTIFACTS_ROUTE, artifactAddress } from "@haibun/core/lib/run-artifact.js";
import { reportToRun } from "./client-log.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";

/** The address of one artifact, from what the event recorded of it: its own URL, its path under the run, or the path
 *  relative to the feature's directory that a report is written into. */
export function artifactUrl(artifact: { url?: unknown; path?: unknown; featureRelativePath?: unknown }): string | undefined {
	const url = typeof artifact.url === "string" ? artifact.url : undefined;
	const base = artifact.path ? String(artifact.path).replace(/^\.?\//, "") : undefined;
	// A report sits in the feature's directory, so an artifact of that feature is beside it: the leading `featn-N/` of
	// the run-relative path is what the report's own directory already is.
	const besideTheFile = base ? `./${base.split("/").slice(1).join("/")}` : undefined;
	if (isOffline()) return (typeof artifact.featureRelativePath === "string" ? artifact.featureRelativePath : undefined) ?? url ?? besideTheFile;
	return url ?? (base ? artifactAddress(base) : undefined);
}

/** The run's artifacts this page has read, by address, as the object URLs a view shows them at. */
const shown = new Map<string, Promise<string>>();

/**
 * The address a view shows an artifact at. The run serves its artifacts only to a caller holding a private read, so an
 * artifact the run serves is read under the page's delegation and shown at an object URL of what it read. A page opened
 * as a file reads its artifacts beside itself, and any other address is shown as it is.
 */
export function shownArtifact(url: string): Promise<string> {
	if (isOffline() || !url.startsWith(`${ARTIFACTS_ROUTE}/`)) return Promise.resolve(url);
	const reading = shown.get(url) ?? readArtifact(url);
	shown.set(url, reading);
	// A read that failed is read again when a view next shows the artifact.
	reading.catch(() => shown.delete(url));
	return reading;
}

/** The address a view shows an artifact at, or undefined once the run is told why the artifact couldn't be read. */
export const shownOrReported = (url: string, source: string): Promise<string | undefined> =>
	shownArtifact(url).catch((err: unknown) => {
		reportToRun("warn", source, `an artifact couldn't be shown: ${errorDetail(err)}`, { url });
		return undefined;
	});

/** An artifact's address as a view binds it, once the page has read it: lit's `nothing` until then, or where it couldn't be read. */
export const artifactAt = (url: string, source: string) =>
	until(
		shownOrReported(url, source).then((at) => at ?? nothing),
		nothing,
	);

async function readArtifact(url: string): Promise<string> {
	const response = await fetch(url, { headers: await readingHeaders(url, READS_THE_RUNS_ARTIFACTS) });
	if (!response.ok) throw new Error(`the run refused its artifact ${url}: ${response.status} ${await response.text()}`);
	return URL.createObjectURL(await response.blob());
}
