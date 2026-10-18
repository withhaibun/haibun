/**
 * The address of an artifact of actuality: on a served page, its address on actuality's artifact route; on a page opened as
 * a file, its path in the file's own directory, since the report is written into the feature's directory.
 */
import { artifactAddress } from "@haibun/core/lib/domains/run-artifact.js";
import { isWebAddress } from "@haibun/core/lib/domains/document-content.js";

/** An event's record of an artifact: its own URL, its path under actuality, and its path relative to its feature's directory. */
export type TArtifactRecord = { url?: unknown; path?: unknown; featureRelativePath?: unknown };

/** Returns a record's address if it is a path or a web address, and undefined for any other scheme. A `javascript:`
 *  address runs in the page. A `data:` address holds a document the record wrote. */
const followable = (address: unknown): string | undefined => (typeof address === "string" && (!URL.canParse(address) || isWebAddress(address)) ? address : undefined);

/** Returns the address of one artifact from the event's record of it: its own URL, its path under actuality, or, on a page
 *  opened as a file, its path relative to the feature's directory. A report is written into the feature's directory. */
export function artifactAddressOf(artifact: TArtifactRecord, offline: boolean): string | undefined {
	const url = followable(artifact.url);
	const base = artifact.path ? String(artifact.path).replace(/^\.?\//, "") : undefined;
	// A report is written into its feature's directory. The path's leading `featn-N/` segment names that directory, so
	// removing it gives the artifact's address relative to the report.
	const besideTheFile = base ? `./${base.split("/").slice(1).join("/")}` : undefined;
	if (offline) return followable(artifact.featureRelativePath) ?? url ?? besideTheFile;
	return url ?? (base ? artifactAddress(base) : undefined);
}
