/**
 * Where an artifact of the run is read from. A served page reads it from the run's artifact route; a page opened as a
 * file reads it beside itself, since the report is written into the feature's own directory. One rule, so a view that
 * shows an artifact states what to show and not where a page came from.
 */
import { isOffline } from "./rpc-registry.js";

/** The address of one artifact, from what the event recorded of it: its own URL, its path under the run, or the path
 *  relative to the feature's directory that a report is written into. */
export function artifactUrl(artifact: { url?: unknown; path?: unknown; featureRelativePath?: unknown }): string | undefined {
	const url = typeof artifact.url === "string" ? artifact.url : undefined;
	const base = artifact.path ? String(artifact.path).replace(/^\.?\//, "") : undefined;
	// A report sits in the feature's directory, so an artifact of that feature is beside it: the leading `featn-N/` of
	// the run-relative path is what the report's own directory already is.
	const besideTheFile = base ? `./${base.split("/").slice(1).join("/")}` : undefined;
	if (isOffline()) return (typeof artifact.featureRelativePath === "string" ? artifact.featureRelativePath : undefined) ?? url ?? besideTheFile;
	return url ?? (base ? `/artifacts/${base}` : undefined);
}
