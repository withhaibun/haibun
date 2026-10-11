/**
 * The one per-@type presentation facade, keyed by the JSON-LD @type. A type's appearance is a backend-neutral NodeMark,
 * derived from the JSON-LD rels a node carries (time → bar, geo → marker, image → sprite, else chip) through the
 * capability presenter; a registered presenter can override it per type. The 3D and SVG paints take a node's appearance
 * from `mark`, so the renders draw a type alike.
 */
import { presenterForType, type PresentContext, type SceneNode } from "./node-presenters.js";
import type { NodeMark } from "../domains/graph-scene.js";

type TypePresentation = {
	/** The node's backend-neutral mark (appearance + layout role): the appearance both graph paints render. */
	mark(node: SceneNode, ctx: PresentContext): NodeMark;
};

/** The presentation facade for a JSON-LD @type: its appearance, from its rels. */
export function presentationForType(type: string): TypePresentation {
	return { mark: (node, ctx) => presenterForType(type).present(node, ctx) };
}
