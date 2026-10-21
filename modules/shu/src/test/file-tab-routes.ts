/** What the file tab integration test and the page it serves share: the page's entry, the id of the button that opens a
 *  file's tab, and where the page counts its reads of the device and keeps each read that failed. */
export const FILE_TAB_PAGE = { entry: "/page.js", open: "open-file", reads: "reads", failures: "failures" } as const;
