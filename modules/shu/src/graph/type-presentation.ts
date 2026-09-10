/**
 * The one per-@type presentation facade. A type's presentation has two facets and both are JSON-LD-aligned, keyed by
 * the JSON-LD @type:
 *   - APPEARANCE: a backend-neutral NodeMark, derived from the JSON-LD rels a node carries (time → bar, geo → marker,
 *     image → sprite, else chip), via the capability presenter; a registered presenter can override per type.
 *   - COLUMN: the component a type opens in a view column, from its domain.ui.component (declared by `set of {Type}
 *     by {jsonld}` / a core domain).
 * Every surface asks HERE: the 3D + SVG paints take a node's appearance from `mark`, the column system takes the
 * column tag from `columnComponent`. One source of truth, so the three renders can't disagree about a type.
 */
import { presenterForType, type PresentContext, type SceneNode } from "./node-presenters.js";
import { getRecordComponent } from "../rels-cache.js";
import type { NodeMark } from "./graph-scene.js";

export type TypePresentation = {
	/** The node's backend-neutral mark (appearance + layout role): the appearance both graph paints render. */
	mark(node: SceneNode, ctx: PresentContext): NodeMark;
	/** The custom column component for this @type, or undefined → the generic entity column. */
	columnComponent(): string | undefined;
};

/** The presentation facade for a JSON-LD @type: appearance (from its rels) + column (from its domain). */
export function presentationForType(type: string): TypePresentation {
	return {
		mark: (node, ctx) => presenterForType(type).present(node, ctx),
		columnComponent: () => getRecordComponent(type),
	};
}
