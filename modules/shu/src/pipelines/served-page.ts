/**
 * The page a server serves: its hydration, its bundle loaded under a nonce made for the response, and the policy that
 * runs only the scripts that nonce names and the modules they load.
 */
import { randomBytes } from "node:crypto";
import { currentVersion } from "@haibun/core/lib/domains/current-version.js";
import type { TPageBuild, TServedHydration } from "../domains/hydration.js";
import { buildSpaHtml } from "../derivations/page-html.js";
import { pagePolicy } from "../derivations/content-security-policy.js";
import type { TBundleFile } from "../ports.js";
import { BUNDLE_NAMES, bundleFileName } from "../domains/bundle-files.js";
import { labelFontFallback } from "../derivations/label-font-fallback.js";

/** How many random bytes a page's script nonce holds: 128 bits, as CSP3 requires of a nonce. */
const SCRIPT_NONCE_BYTES = 16;

/** The build the served page's code is from: this module's version, and when its bundle was written. A deployment that
 *  serves a page older than its source recognizes it by this. */
export const servedBuild = (bundles: TBundleFile): TPageBuild => ({ version: currentVersion, builtAt: bundles.pageBuiltAt(bundleFileName(BUNDLE_NAMES.page)) });

/** The served page at `basePath`, and the Content-Security-Policy its response carries. */
export function servedPage(basePath: string, hydration: TServedHydration): { html: string; policy: string } {
	const nonce = randomBytes(SCRIPT_NONCE_BYTES).toString("base64");
	return { html: buildSpaHtml(basePath, hydration, nonce), policy: pagePolicy(hydration.settings.embedderOrigin, nonce) };
}

/** The response to a request of troika's lookup of fallback label fonts at `path`, below the fallback address: an index or
 *  the fallback font's metadata as JSON, the label font as the fallback font's file, or undefined for another path. */
export function labelFontResponse(bundles: TBundleFile, path: string): { json: unknown } | { font: ArrayBuffer } | undefined {
	const answer = labelFontFallback(path);
	if (answer === undefined) return undefined;
	return answer.kind === "json" ? { json: answer.body } : { font: bundles.labelFont() };
}
