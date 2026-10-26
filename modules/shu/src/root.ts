/**
 * Serving's composition root: the bundles the steppers serve, the file a report is written to, and how a peer's graph is
 * opened.
 */
import { currentVersion } from "@haibun/core/lib/adapters/current-version.js";
import { bundleFile } from "./adapters/bundle-file.js";
import { reportFile } from "./adapters/report-file.js";
import { RemoteGraphSource } from "./adapters/remote-graph-source.js";
import type { TBundleFile, TOpenPeerGraphSource, TReportFile } from "./ports.js";

/** The bundles under `build/`, one reader for the process. */
export const servedBundles: TBundleFile = bundleFile();

/** The version of the page the steppers serve: haibun's, at which its modules release together. */
export const servedVersion = currentVersion;

/** Where a report is written. */
export const reportWriter: TReportFile = reportFile();

/** Opens a peer's graph source over RPC. */
export const openPeerGraphSource: TOpenPeerGraphSource = (url, sign, calls) => new RemoteGraphSource({ url, sign, calls });
