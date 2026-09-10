/**
 * The served asset's entry: the two views that share one bundle because they share the 3D scene, and loading it twice
 * would put two copies of the graphics library on one page.
 *
 * Importing this registers `<shu-polymorphic-graph-view>` and `<shu-class-browser>`. Neither view imports the other:
 * what ships together is stated here, once, where the bundle is defined.
 */
import "./shu-polymorphic-graph-view.js";
import "./shu-class-browser.js";
