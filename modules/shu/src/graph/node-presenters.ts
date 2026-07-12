/**
 * Per-@type node presenters: each decides a node's SEMANTIC presentation (a backend-neutral NodeMark), the view hands
 * each node off to `presenterForType(node.type)`. A registry keyed by @type with a capability-driven DEFAULT covers
 * unregistered types — so this is hypermedia-led (a node's declared rels/capabilities pick its mark) with per-type
 * overrides, not a hardcoded type enumeration. Pure + fail-fast (every mark goes through assertNodeMark). The colour is
 * the shared per-type colour (one source of truth across 3D + SVG); the paints translate the mark to their medium.
 */
import { colorForType } from "../type-colors.js";
import { assertNodeMark, type NodeMark } from "./graph-scene.js";
import { ONTOLOGY_CLASS, ONTOLOGY_PROPERTY } from "./ontology-projection.js";

/** The slice of a node a presenter reads — identity + display name + @type. */
export type SceneNode = { id: string; name: string; type: string; isCluster?: boolean; properties?: Record<string, unknown> };
/** Capabilities the layout has detected for this node (from its declared rels), passed as context to the presenter.
 *  `time` = a placed calendar task (epoch-ms span + the bar's world length); absent when not time-laid-out. */
export type PresentContext = { time?: { start: number; end: number; zExtent: number } };

export interface NodePresenter {
	/** A node's mark — what it looks like + its layout role. Must return an assertNodeMark()-validated mark. */
	present(node: SceneNode, ctx: PresentContext): NodeMark;
}

/** The fallback presenter for any unregistered @type: capability-driven. A node placed as a calendar task renders as a
 *  duration box on its time span; otherwise a type-coloured label chip in the free (force) layout. */
export const DEFAULT_PRESENTER: NodePresenter = {
	present(n, ctx) {
		const color = colorForType(n.type);
		if (ctx.time && !n.isCluster) {
			return assertNodeMark({
				id: n.id,
				type: n.type,
				kind: "box",
				label: n.name,
				color,
				isCluster: n.isCluster,
				zExtent: ctx.time.zExtent,
				role: { kind: "time", start: ctx.time.start, end: ctx.time.end },
			});
		}
		return assertNodeMark({ id: n.id, type: n.type, kind: "chip", label: n.name, color, isCluster: n.isCluster, role: { kind: "free" } });
	},
};

const registry = new Map<string, NodePresenter>();

/** Register a presenter for a concrete @type (overrides the capability default for that type). */
export function registerNodePresenter(type: string, presenter: NodePresenter): void {
	registry.set(type, presenter);
}

/** The presenter for a @type — a registered one, else the capability-driven default. */
export function presenterForType(type: string): NodePresenter {
	return registry.get(type) ?? DEFAULT_PRESENTER;
}

// The folded ontology's SCHEMA types each carry their own paint KIND, symmetrically through the mark registry: a Property
// is a "lozenge" (an elongated diamond holding the name), a Class a "square" token — set apart from the rounded instance
// chips. The plain @type name is the label; the shape carries the kind.
const schemaPresenter = (schema: "class" | "property"): NodePresenter => ({
	present: (n) =>
		assertNodeMark({
			id: n.id,
			type: n.type,
			kind: schema === "property" ? "lozenge" : "square",
			label: n.name,
			color: colorForType(n.type),
			role: { kind: "free" },
			// a Property a standard vocabulary declares but the type's data never uses (inData=false) is drawn ghosted.
			faint: schema === "property" && n.properties?.inData === false,
		}),
});
registerNodePresenter(ONTOLOGY_CLASS, schemaPresenter("class"));
registerNodePresenter(ONTOLOGY_PROPERTY, schemaPresenter("property"));
