/** The routes the polymorphic integration test's server serves: the page's entry, and the view's bundle that entry loads. */
export const POLYMORPHIC_ROUTE = { entry: "/page.js", bundle: "/bundle.js" } as const;
/** Where the page keeps the methods it called of its site, in order, for a test that reads which calls the page made. */
export const DISPATCHED_KEY = "dispatched";
