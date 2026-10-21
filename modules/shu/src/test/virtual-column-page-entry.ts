/**
 * The entry of the page a virtual column integration test serves. It starts the page as a test page starts, and mounts a
 * following column over rows that the test appends through `appendRows`: a row that shows content is a fixed height, and a
 * row that doesn't show content doesn't take room, as its source states. The page keeps the text of the element each click reached.
 */
import { html, type CSSResult } from "lit";
import { setupShuTest } from "./setup.js";
import { VIRTUAL_COLUMN_PAGE } from "./virtual-column-routes.js";
import { SHU_TAG } from "../domains/elements.js";
import { virtualColumnCss, type ShuVirtualColumn } from "../page/components/shu-virtual-column.js";
import { arrayWindowedSource, unmarked } from "../page/derivations/windowed-source.js";

setupShuTest({ dispatch: () => ({}) });
const { styleSheet } = virtualColumnCss as CSSResult;
if (styleSheet === undefined) throw new Error("the browser doesn't construct a style sheet, which the column's layout reads");
document.adoptedStyleSheets = [styleSheet];
/** Whether each row shows content. */
const shown: boolean[] = [];
const rows = arrayWindowedSource<boolean>(shown, unmarked());
const column = document.createElement(SHU_TAG.VIRTUAL_COLUMN) as ShuVirtualColumn;
column.source = { ...rows, rowSize: (i) => (rows.rowAt(i) === false ? 0 : undefined) };
column.follow = true;
column.renderRow = (i, row) => (row === true ? html`<div style="height:${VIRTUAL_COLUMN_PAGE.rowPx}px">${i}</div>` : html`<div></div>`);
document.body.append(column);
const clicked: string[] = [];
document.addEventListener("click", (e) => {
	const [target] = e.composedPath();
	clicked.push(target instanceof Element ? String(target.textContent) : "");
});
Object.assign(globalThis, {
	[VIRTUAL_COLUMN_PAGE.clicked]: clicked,
	[VIRTUAL_COLUMN_PAGE.appendRows]: (more: boolean[]) => {
		shown.push(...more);
		rows.set(shown);
	},
});
