import { getUiByType } from "./rels-cache.js";

/** The component + placement to render a product with, resolved from its type with shape-based defaults. */
export type ResolvedUi = {
	/** Custom-element tag to instantiate. */
	component: string;
	/** Named slot to render into, if the type's UI declares one. */
	slot?: string;
	/** Render only when the subject is pinned (the type's UI opts in). */
	pinnedOnly: boolean;
};

/** Default component for a single entity when the type declares none. */
export const ENTITY_COMPONENT = "shu-entity-column";
/** Default component for a collection (a product carrying `items`) when the type declares none. */
export const COLLECTION_COMPONENT = "shu-thread-column";

/**
 * Resolve how to render a product: its `_component` (stamped from the type's domain UI), else the type's registered
 * UI component, else a shape default — a collection (carrying `items`) → the thread column, a single entity → the
 * entity column. This makes the type→component registry total: every product resolves to exactly one component, the
 * single dispatch rule the unified renderer uses instead of sniffing the product's shape.
 */
export function resolveUi(product: Record<string, unknown>): ResolvedUi {
	const type = typeof product._type === "string" ? product._type : undefined;
	const ui = type ? getUiByType(type) : undefined;
	const uiComponent = ui?.component;
	const declared = (typeof product._component === "string" ? product._component : undefined) ?? (typeof uiComponent === "string" ? uiComponent : undefined);
	const isCollection = Array.isArray(product.items) && product.items.length > 0;
	const component = declared ?? (isCollection ? COLLECTION_COMPONENT : ENTITY_COMPONENT);
	const uiSlot = ui?.slot;
	return { component, slot: typeof uiSlot === "string" ? uiSlot : undefined, pinnedOnly: ui?.pinnedOnly === true };
}
