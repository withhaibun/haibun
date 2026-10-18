/** The pane a step's response names, opened through the pane controller. It is apart from the pane controller, so a bundle
 *  that doesn't open a pane from a step's response doesn't hold the parse of one. */
import { parseAffordanceProduct } from "../derivations/affordances.js";
import { requestPane } from "./pane-controller.js";

/** Opens the pane a step's response names: a response that names a component opens it with the step's products. Returns
 *  what the response names. A step caller and the affordances panel both call this when a step returns. */
export function dispatchAffordanceFromResponse(response: unknown): ReturnType<typeof parseAffordanceProduct> {
	const action = parseAffordanceProduct(response);
	if (action.kind === "open-component") requestPane({ paneType: "component", tag: action.component, label: action.label, data: action.products });
	return action;
}
