/**
 * The page's composition root. It installs each of the page's ports once per page, and every bundle on the page reads the
 * installed port, since a bundle that loads this module holds its own copy of it.
 */
import { pagePinned } from "../page-pinned.js";
import type { TClock, TPreferences } from "./ports.js";
import { cookiePreferences } from "./adapters/prefs-cookie.js";
import { browserClock } from "./adapters/clock.js";

const PREFERENCES_KEY = "__SHU_PREFERENCES__";
const CLOCK_KEY = "__SHU_CLOCK__";

/** Returns the page's preferences, stored in the page's cookies. */
export const pagePreferences = (): TPreferences => pagePinned(PREFERENCES_KEY, () => cookiePreferences(window));

/** Returns the page's clock: the browser's time, timers and frames, or the clock `installClock` installed. */
export const pageClock = (): TClock => pagePinned(CLOCK_KEY, () => browserClock(window));

/** Installs `clock` as the page's clock where the page doesn't hold one yet. A test installs a clock it advances. */
export const installClock = (clock: TClock): TClock => pagePinned(CLOCK_KEY, () => clock);
