/**
 * One path from "RPC response" → "open/close pane".
 *
 * Both shu-step-caller and shu-affordances-panel call this when a step returns.
 * It parses the response for hypermedia view markers and calls PaneState directly —
 * no custom events, no event-bus indirection. PaneState owns the pane lifecycle.
 */
import { parseAffordanceProduct } from "./affordance-products.js";
import { getVertexUi, vertexLabelForDomain } from "./rels-cache.js";
import { PaneState, paneIdOf } from "./pane-state.js";

export function dispatchAffordanceFromResponse(response: unknown): ReturnType<typeof parseAffordanceProduct> {
	const action = parseAffordanceProduct(response);
	if (action.kind === "close") {
		PaneState.dismiss(action.view);
	} else if (action.kind === "open-component") {
		PaneState.request({ paneType: "component", tag: action.component, label: action.label, data: action.products });
	} else if (action.kind === "open-type") {
		const ui = getVertexUi(action.type);
		const component = ui?.component;
		if (typeof component === "string") {
			PaneState.request({ paneType: "component", tag: component, label: action.label, data: action.products });
		} else {
			// No ui.component: any vertex domain is openable via shu-entity-column.
			// Map the productsDomain key to its vertex label for getVertexWithEdges.
			const vertexLabel = vertexLabelForDomain(action.type) ?? action.type;
			PaneState.request({ paneType: "entity", id: action.id, vertexLabel, label: action.label });
		}
	}
	return action;
}

/** Re-export so consumers needing the canonical id can use the helper. */
export { paneIdOf };
