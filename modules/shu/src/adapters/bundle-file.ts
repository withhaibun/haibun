/**
 * The bundles `npm run build` writes in `modules/shu/build`, read from disk on each request, so a rebuilt bundle is served
 * on the next request without a restart. A bundle that isn't built is refused with the command that builds it (SH29).
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TBundleFile, TServedAsset } from "../ports.js";

/** The directory the build writes, anchored at the package root, so one path resolves from `src/` and from `build/`. */
const BUILD_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "build");
const APP_BUNDLE = join(BUILD_DIR, "shu-bundle.js");
const REPORT_BUNDLE = join(BUILD_DIR, "shu-report-bundle.js");
const APP_SOURCE_MAP = join(BUILD_DIR, "shu-bundle.js.map");
/** Under `build/assets/`, so the per-file emit of `tsc` doesn't overwrite it. */
const POLYMORPHIC_BUNDLE = join(BUILD_DIR, "assets", "shu-polymorphic-graph-view.js");

/** The command that writes every bundle. */
export const BUILD_COMMAND = "npm run build in modules/shu";

/** Runs `read` on the file at `path`, or throws a refusal that names the bundle and the command that builds it. */
function built<T>(path: string, what: string, read: (path: string) => T): T {
	try {
		return read(path);
	} catch (err) {
		throw new Error(`${what} at ${path} isn't built. Run ${BUILD_COMMAND}.`, { cause: err });
	}
}

const text = (path: string): string => readFileSync(path, "utf-8");
const writtenAt = (path: string): Date => statSync(path).mtime;

/** The bundle files under `build/`. The polymorphic bundle is held until its file changes, since every served page's
 *  concerns carry it. */
export function bundleFile(): TBundleFile {
	let polymorphic: { mtimeMs: number; asset: TServedAsset } | undefined;
	return {
		app: () => built(APP_BUNDLE, "the app bundle", text),
		appBuiltAt: () => built(APP_BUNDLE, "the app bundle", writtenAt).toISOString(),
		report: () => built(REPORT_BUNDLE, "the report bundle", text),
		polymorphic: () => {
			const what = "the polymorphic graph view's bundle";
			const mtimeMs = built(POLYMORPHIC_BUNDLE, what, writtenAt).getTime();
			if (polymorphic?.mtimeMs !== mtimeMs) polymorphic = { mtimeMs, asset: { content: built(POLYMORPHIC_BUNDLE, what, text), etag: `"polymorphic-${mtimeMs}"` } };
			return polymorphic.asset;
		},
		sourceMap: () => built(APP_SOURCE_MAP, "the app bundle's source map", text),
	};
}
