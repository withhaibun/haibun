/**
 * What serving the page names: the addresses of the served assets, and the Content-Security-Policy values every page and
 * artifact carries.
 */
import { MODULE_OPTION_PREFIX } from "@haibun/core/schema/protocol.js";

/** Where the graph view's bundle is served. */
export const POLYMORPHIC_VIEW_JS = "/assets/shu-polymorphic-graph-view.js";

/** Where the font of the graph's labels is served, so the scene draws its labels without a font service (CA3D10). */
export const LABEL_FONT = "/assets/shu-label-font.woff";

/** The address of the served page's source map. The bundle is inlined in the page, so the map is addressed absolutely
 *  rather than beside a file the page doesn't fetch. A reader with developer tools open reads it. */
export const SPA_SOURCE_MAP = "/assets/shu-bundle.js.map";

/** A Content-Security-Policy's source for the site's own pages. */
export const OWN_PAGES = "'self'";

/** ShuStepper's option that names the embedding page's origin. A page that can't frame shu names this option as the setting to change. */
export const EMBEDDER_ORIGIN_OPTION = `${MODULE_OPTION_PREFIX}SHUSTEPPER_EMBEDDER_ORIGIN`;

/** The sandbox flags of an artifact a step saved, wherever the artifact is shown. An artifact can hold the page a step
 *  checked, so it doesn't run a script or access an origin. It can open a link in a tab of its own. A frame states these
 *  flags as its sandbox. */
export const ARTIFACT_SANDBOX = "allow-popups allow-popups-to-escape-sandbox";

/** The policy each served artifact carries. An artifact opened by its address doesn't run a script on this site's origin. */
export const ARTIFACT_POLICY = `sandbox ${ARTIFACT_SANDBOX}`;
