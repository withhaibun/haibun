/**
 * Reusable affordance-pane opener — opens a singleton pane with the named
 * column-type and a child element matching the named tag.
 *
 * Idempotent against concurrent invocations: the pane element is created and
 * added to the strip synchronously before any `await`, so a second caller
 * observes the existing pane via the strip query and returns early. Custom-
 * element loading happens after the pane is mounted.
 *
 * Extracted from `app.ts` so the contract `(parsed action) → (pane created
 * with named child)` can be tested without bootstrapping the whole SPA.
 */
import { SHU_ATTR } from "./consts.js";
import type { ShuColumnPane } from "./components/shu-column-pane.js";
import type { ShuColumnStrip } from "./components/shu-column-strip.js";

export type TPaneOpenerOpts = {
	getStrip: () => ShuColumnStrip | null;
	ensureUiComponentLoaded: (childTag: string) => Promise<void>;
	report?: (message: string, attrs: Record<string, unknown>) => void;
};

export async function openPinnedColumn(columnType: string, label: string, childTag: string, opts: TPaneOpenerOpts): Promise<void> {
	const strip = opts.getStrip();
	if (!strip) throw new Error(`[shu] no column-strip available; cannot open ${columnType}`);
	const existing = strip.panes.filter((p) => p.getAttribute(SHU_ATTR.COLUMN_TYPE) === columnType).length;
	opts.report?.(`openPinnedColumn ${columnType} (${childTag}): existing=${existing}`, {
		"haibun.shu.column.event": "open-attempt",
		"haibun.shu.column.type": columnType,
		"haibun.shu.column.child-tag": childTag,
		"haibun.shu.column.existing-count": existing,
	});
	if (existing > 0) return;
	const pane = document.createElement("shu-column-pane") as ShuColumnPane;
	pane.setAttribute("label", label);
	pane.setAttribute(SHU_ATTR.COLUMN_TYPE, columnType);
	pane.setAttribute(SHU_ATTR.PINNED, "true");
	strip.addPane(pane);
	await opts.ensureUiComponentLoaded(childTag);
	const child = document.createElement(childTag);
	child.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
	pane.appendChild(child);
}
