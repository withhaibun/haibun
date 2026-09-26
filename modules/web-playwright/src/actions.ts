/** The stepper's name, which its actions and its steps' methods begin with. */
export const WEB_PLAYWRIGHT = "WebPlaywright";

/** The actions a delegation names to let another party use the browser, each covering a group of steps: reading the page,
 *  acting on it (navigating, input and tabs), running `fetch` inside it with the page's own cookies, and attaching a
 *  browser a person runs to the relay, through their extension. Kept apart from the stepper, so an extension names them
 *  without bundling it. */
export const WEB_PLAYWRIGHT_ACTIONS = { read: `${WEB_PLAYWRIGHT}:read`, act: `${WEB_PLAYWRIGHT}:act`, fetch: `${WEB_PLAYWRIGHT}:fetch`, attach: `${WEB_PLAYWRIGHT}:attach` } as const;

/** The step that reads the page, which a view of the page names as the call that reads it. */
export const READS_THE_PAGE = "takeAccessibilitySnapshot";
