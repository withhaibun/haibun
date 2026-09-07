/**
 * Route step-end hypermedia products to pane operations: the intent-bearing ones, the latest per pane in a batch.
 *
 * A hidden trace-level substep (isSubStep → level "trace", the same level the log view hides) is infrastructure. A
 * hidden substep or a view's own refetch of its data can carry view markers in its products without anyone asking for
 * that view, so only the steps a reader can see in the log act as view commands. A reader's own invocation of a step
 * opens its view from the response it asked for (`affordance-dispatch`), which is the one thing that can say a reader
 * asked, while the SPA cannot write to the graph.
 *
 * The stream announces what happens from here on and replays nothing, so every event here is a live occurrence: a view
 * a reader closed is reopened only by the run showing it again, which is a new decision.
 *
 * Within one batch the LATEST op per pane wins, keyed by pane identity; the order across DISTINCT panes is preserved by
 * Map insertion order.
 */
import { SUBSTEP_LEVEL, type THaibunEvent, type THypermediaProducts } from "@haibun/core/schema/protocol.js";
import { parseAffordanceProduct } from "./affordance-products.js";
import type { TAffordanceView } from "./affordance-products.js";
import type { TEvent } from "./event-stream.js";

export type TPaneOp = { op: "component"; tag: string; label: string; data: Record<string, unknown> } | { op: "views-picker"; views: TAffordanceView[]; label: string };

export function paneOpsFor(events: TEvent[]): Map<string, TPaneOp> {
	const ops = new Map<string, TPaneOp>();
	for (const event of events) {
		const e = event as THaibunEvent & { products?: THypermediaProducts };
		if (e.kind !== "lifecycle" || e.type !== "step" || e.stage !== "end" || e.status !== "completed" || !e.products) continue;
		if (e.level === SUBSTEP_LEVEL) continue; // a hidden substep is infrastructure, not a reader's intent
		const action = parseAffordanceProduct(e.products);
		if (action.kind === "open-component") ops.set(action.component, { op: "component", tag: action.component, label: action.label, data: action.products });
		else if (action.kind === "show-views") ops.set("views", { op: "views-picker", views: action.views, label: action.label });
	}
	return ops;
}
