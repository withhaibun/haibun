/**
 * The served asset's entry: the two views that share one bundle because they share the 3D scene, and loading it twice
 * would put two copies of the graphics library on one page.
 *
 * Importing this registers `<shu-polymorphic-graph-view>` and `<shu-class-browser>`. The two views don't import each other:
 * what ships together is stated here, once, where the bundle is defined.
 */
import "../src/page/graph/components/shu-polymorphic-graph-view.js";
import "../src/page/graph/components/shu-class-browser.js";
