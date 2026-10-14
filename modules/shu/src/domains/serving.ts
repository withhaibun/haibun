/**
 * What serving the page names: the addresses of the served assets, and the Content-Security-Policy values every page
 * carries. Core's `run-artifact.ts` states the policy an artifact carries.
 */
import { MODULE_OPTION_PREFIX } from "@haibun/core/schema/protocol.js";

/** Where the graph view's bundle is served. */
export const POLYMORPHIC_VIEW_JS = "/assets/shu-polymorphic-graph-view.js";

/** Where the font of the graph's labels is served, so the scene draws its labels without a font service (CA3D10). */
export const LABEL_FONT = "/assets/shu-label-font.woff";

/** Where troika's lookup of fallback fonts reads, for a label character the label font lacks (`label-font-fallback.ts`). */
export const LABEL_FONT_FALLBACKS = "/assets/shu-label-fonts";

/** The shapes of the resolver's requests below `LABEL_FONT_FALLBACKS`, as route paths. */
export const LABEL_FONT_FALLBACK_ROUTES = ["codepoint-index/:plane/:range", "font-meta/:font", "font-files/:font/:file"] as const;

/** The address of the served page's source map. The bundle is inlined in the page, so the map is addressed absolutely
 *  rather than beside a file the page doesn't fetch. A reader with developer tools open reads it. */
export const SPA_SOURCE_MAP = "/assets/shu-bundle.js.map";

/** A Content-Security-Policy's source for the site's own pages. */
export const OWN_PAGES = "'self'";

/** ShuStepper's option that names the embedding page's origin. A page that can't frame shu names this option as the setting to change. */
export const EMBEDDER_ORIGIN_OPTION = `${MODULE_OPTION_PREFIX}SHUSTEPPER_EMBEDDER_ORIGIN`;
