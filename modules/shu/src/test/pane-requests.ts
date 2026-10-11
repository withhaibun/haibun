/** The panes a test opens, as the page's pane machine takes each request. */
import { pagePanes } from "../page/root.js";
import { PANES_EVENT } from "../page/machines/panes.js";
import type { DesiredPane } from "../page/derivations/pane-kinds.js";
import type { TPaneHooks } from "../page/pipelines/panes.js";

/** Follows the requests the page's pane machine takes, in order, until `stop` is called. */
export function followPaneRequests(): { requested: DesiredPane[]; stop: () => void } {
	const requested: DesiredPane[] = [];
	const stop = pagePanes().follow((move) => {
		if (move.event.type === PANES_EVENT.REQUEST) requested.push(move.event.pane);
	});
	return { requested, stop };
}

/** The hooks of a test page, whose views its tests define by importing them, and whose views aren't given their pane's data. */
export const IMPORTED_VIEWS: TPaneHooks = { load: () => Promise.resolve(), attach: {} };
