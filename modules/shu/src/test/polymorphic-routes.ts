/** The routes the polymorphic integration test's server serves: the page's entry, and the view's bundle that entry loads,
 *  both below `/assets/page/` as the service serves them, so the bundle reads the label font beside it over the same route
 *  the service serves fonts under. */
export const POLYMORPHIC_ROUTE = { entry: "/assets/page/page.js", bundle: "/assets/page/bundle.js" } as const;
/** Where the page keeps the methods it called of its site, in order, for a test that reads which calls the page made. */
export const DISPATCHED_KEY = "dispatched";
