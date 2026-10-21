/** What the virtual column integration test and the page it serves share: the page's entry, the call on the page that
 *  appends rows, where the page keeps what each click reached, and the height of a row that shows content. */
export const VIRTUAL_COLUMN_PAGE = { entry: "/page.js", appendRows: "appendRows", clicked: "clicked", rowPx: 40 } as const;
