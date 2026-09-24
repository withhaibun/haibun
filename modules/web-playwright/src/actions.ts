/** The actions a delegation names to let another party use the browser, each covering a group of steps: reading the page,
 *  acting on it (navigating, input and tabs), running `fetch` inside it with the page's own cookies, and attaching a
 *  browser a person runs to the relay, through their extension. Kept apart from the stepper, so an extension names them
 *  without bundling it. */
export const WEB_PLAYWRIGHT_ACTIONS = { read: "WebPlaywright:read", act: "WebPlaywright:act", fetch: "WebPlaywright:fetch", attach: "WebPlaywright:attach" } as const;
