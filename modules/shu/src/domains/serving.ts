/**
 * What serving the page names: the addresses of the served assets, and the Content-Security-Policy values every page
 * carries. Core's `run-artifact.ts` states the policy an artifact carries.
 */
import { MODULE_OPTION_PREFIX } from "@haibun/core/lib/domains/protocol.js";
import { BUNDLE_NAMES, PAGE_CHUNK_DIR, bundleFileName } from "./bundle-files.js";

/** Where the font of the graph's labels is served, so the scene draws its labels without a font service (CA3D10). */
export const LABEL_FONT = "/assets/shu-label-font.woff";

/** Where troika's lookup of fallback fonts reads, for a label character the label font lacks (`label-font-fallback.ts`). */
export const LABEL_FONT_FALLBACKS = "/assets/shu-label-fonts";

/** The shapes of the resolver's requests below `LABEL_FONT_FALLBACKS`, as route paths. */
export const LABEL_FONT_FALLBACK_ROUTES = ["codepoint-index/:plane/:range", "font-meta/:font", "font-files/:font/:file"] as const;

/** Where the page's bundle is served, with its source map and its chunks: the code of a rare path, which the page loads at
 *  its first use, and the code such a chunk shares with the bundle. */
export const PAGE_ASSETS = "/assets/page";
/** The chunks below `PAGE_ASSETS`, in the build's folder for them. */
export const PAGE_CHUNKS = `${PAGE_ASSETS}/${PAGE_CHUNK_DIR}`;
/** The page's bundle, which the served page loads as a module under the response's script nonce. */
export const PAGE_BUNDLE_JS = `${PAGE_ASSETS}/${bundleFileName(BUNDLE_NAMES.page)}`;
/** The graph view's bundle, which the page loads as the reader opens the view. */
export const POLYMORPHIC_VIEW_JS = `${PAGE_ASSETS}/${bundleFileName(BUNDLE_NAMES.polymorphic)}`;

/** A Content-Security-Policy's source for the site's own pages. */
export const OWN_PAGES = "'self'";

/** ShuStepper's option that names the embedding page's origin. A page that can't frame shu names this option as the setting to change. */
export const EMBEDDER_ORIGIN_OPTION = `${MODULE_OPTION_PREFIX}SHUSTEPPER_EMBEDDER_ORIGIN`;
