/**
 * The bundles shu's build writes for a browser, by name: `scripts/bundles.ts` writes them, and the page and its server name them
 * by these. The module holds its constants without imports, so the build script loads it as it stands.
 */

/** Each bundle by the name of its output, without its extension. */
export const BUNDLE_NAMES = { page: "shu-bundle", report: "shu-report-bundle", polymorphic: "shu-polymorphic-graph-view" } as const;

/** The file of a bundle by its name. */
export const bundleFileName = (name: string): string => `${name}.js`;

/** The folder below the page's that holds its chunks. */
export const PAGE_CHUNK_DIR = "chunks";
