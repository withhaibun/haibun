/**
 * Reads the page's hydration as the bundle loads, before any view's module, since a view's module reads the hydration as it
 * loads. The served document holds the hydration element before the bundle's script, so the element is in the document.
 */
import { hydrateFromDom } from "../src/page/controllers/hydration-controller.js";

hydrateFromDom();
