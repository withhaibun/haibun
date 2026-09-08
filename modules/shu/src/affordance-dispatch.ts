/**
 * One path from "RPC response" → "open pane".
 *
 * Both shu-step-caller and shu-affordances-panel call this when a step returns.
 * It parses the response for hypermedia view markers and calls PaneState directly —
 * no custom events, no event-bus indirection. PaneState owns the pane lifecycle.
 */
import { parseAffordanceProduct } from "./affordance-products.js";
import { PaneState, paneIdOf } from "./pane-state.js";

export function dispatchAffordanceFromResponse(response: unknown): ReturnType<typeof parseAffordanceProduct> {
	const action = parseAffordanceProduct(response);
	if (action.kind === "open-component") PaneState.request({ paneType: "component", tag: action.component, label: action.label, data: action.products });
	return action;
}

/** Re-export so consumers needing the canonical id can use the helper. */
export { paneIdOf };
