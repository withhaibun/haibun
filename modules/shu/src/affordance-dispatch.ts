/**
 * One path from "RPC response" → "open pane".
 *
 * Both shu-step-caller and shu-affordances-panel call this when a step returns.
 * It parses the response for hypermedia view markers and requests each pane through the pane controller,
 * without custom events or an event bus. The pane machine holds the panes.
 */
import { parseAffordanceProduct } from "./page/derivations/affordances.js";
import { requestPane } from "./page/controllers/pane-controller.js";
import { paneIdOf } from "./page/derivations/pane-kinds.js";

export function dispatchAffordanceFromResponse(response: unknown): ReturnType<typeof parseAffordanceProduct> {
	const action = parseAffordanceProduct(response);
	if (action.kind === "open-component") requestPane({ paneType: "component", tag: action.component, label: action.label, data: action.products });
	return action;
}

/** Re-export so consumers needing the canonical id can use the helper. */
export { paneIdOf };
