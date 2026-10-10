/**
 * The page's conduit, as a controller and a view that hasn't moved onto one call actuality through it. The data-access
 * scan reads an import of `conduit` from this module as a view's own call, so a view that imports it stays on the scan's
 * list until it reads through a controller.
 */
import { hasConduit as pageHasConduit, pageConduit } from "../root.js";
import type { TConduit } from "../ports.js";

/** Returns the page's conduit. */
export const conduit = (): TConduit => pageConduit();

/** Whether the page holds a conduit. */
export const hasConduit = (): boolean => pageHasConduit();

export { lastResponseAt as serverLastRespondedAt } from "../root.js";
