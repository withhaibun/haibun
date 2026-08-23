/**
 * The one global window size: how many rows a windowed query fetches. Since the views virtualize their rendering to
 * the viewport, this is the page size of the run sources (how many events a page of the run caches, client-cache) and of
 * the graph query's server-side page. The setting lives here, apart from the picker element (<shu-window-size>), so the
 * library that reads it does not import a component.
 */
import { persistedSetting } from "./signals.js";

const STORAGE_WINDOW_SIZE = "shu.windowSize";

/** First-run fallback rows per windowed view — a named const (never a bare literal), and a member of WINDOW_SIZES. */
export const DEFAULT_WINDOW_SIZE = "500";

/** Rows fetched per windowed query (the graph query's page size). One global setting. `∞` (9e9) is effectively unlimited. */
export const WINDOW_SIZES = [
	{ value: "50", label: "50" },
	{ value: DEFAULT_WINDOW_SIZE, label: DEFAULT_WINDOW_SIZE },
	{ value: "2000", label: "2000" },
	{ value: "5000", label: "5000" },
	{ value: "10000", label: "10000" },
	{ value: "20000", label: "20000" },
	{ value: "9000000000", label: "∞" },
] as const;

/** The one global window-size setting. Exported alongside its reader `getWindowSize` so the picker element and tests
 *  drive the same handle rather than reaching into storage. */
export const windowSizeSetting = persistedSetting(STORAGE_WINDOW_SIZE, DEFAULT_WINDOW_SIZE, (v) => WINDOW_SIZES.some((w) => w.value === v));

/** The global window size (rows per windowed query), read reactively so a settings change re-runs every consumer. */
export function getWindowSize(): number {
	return Number.parseInt(windowSizeSetting.get(), 10);
}
