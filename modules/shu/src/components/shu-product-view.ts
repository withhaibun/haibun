/**
 * <shu-product-view> — Unified product renderer.
 * Inspects product shape and delegates to the appropriate view component:
 *   _component → live web component (graph, sequence, monitor)
 *   items[]    → shu-thread-column (flat/tree/graph views with relations)
 *   otherwise  → shu-entity-column (field table for single entities)
 */
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import type { ShuThreadColumn } from "./shu-thread-column.js";
import type { ShuEntityColumn } from "./shu-entity-column.js";

const ProductViewSchema = z.object({});

type ThreadVertex = Record<string, unknown> & { _id: string; _inReplyTo?: string; _edges?: { type: string; targetId: string }[] };

/** Normalize a product item into a ThreadVertex for the thread column. */
function normalizeItem(item: Record<string, unknown>): ThreadVertex {
	const _id = String(item["@id"] ?? item._id ?? item.vertexLabel ?? item.id ?? item.name ?? "");
	const _label = String(item["@type"] ?? item._label ?? item._type ?? "");

	// Merge _links → _edges and existing _edges
	const existingEdges = (item._edges ?? []) as { type: string; targetId: string }[];
	const links = item._links as Record<string, { method?: string; params?: Record<string, unknown> }> | undefined;
	const linkEdges: { type: string; targetId: string }[] = [];
	if (links) {
		for (const [rel, link] of Object.entries(links)) {
			if (link.params) {
				const targetId = String(Object.values(link.params)[0] ?? "");
				if (targetId) linkEdges.push({ type: rel, targetId });
			}
		}
	}
	const _edges = [...existingEdges, ...linkEdges];

	return { ...item, _id, ...(_label ? { _label } : {}), ...(_edges.length ? { _edges } : {}) };
}

export class ShuProductView extends ShuElement<typeof ProductViewSchema> {
	constructor() {
		super(ProductViewSchema, {});
	}

	/** Render products using the appropriate view component. */
	openProducts(products: Record<string, unknown>, snapshotTime?: number): void {
		if (!this.shadowRoot) return;
		this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="product-container"></div>`;
		const container = this.shadowRoot.querySelector(".product-container") as HTMLElement;

		const propagateControls = (el: HTMLElement) => {
			if (this.showControls) el.setAttribute("data-show-controls", "");
		};

		if (products._component) {
			const view = document.createElement(String(products._component));
			if (snapshotTime !== undefined) view.setAttribute("data-snapshot-time", String(snapshotTime));
			propagateControls(view);
			view.style.minHeight = "300px";
			view.style.height = "100%";
			view.style.display = "block";
			container.appendChild(view);
		} else if (products.items && Array.isArray(products.items) && products.items.length > 0) {
			const thread = document.createElement("shu-thread-column") as ShuThreadColumn;
			propagateControls(thread);
			container.style.minHeight = "350px";
			container.appendChild(thread);
			const items = (products.items as Record<string, unknown>[]).map(normalizeItem);
			requestAnimationFrame(() => thread.openItems(items, String(products._type || "Result")));
		} else {
			const entity = document.createElement("shu-entity-column") as ShuEntityColumn;
			propagateControls(entity);
			entity.style.height = "100%";
			container.appendChild(entity);
			requestAnimationFrame(() => entity.openProducts(products));
		}
	}

	override refresh(): void {
		const container = this.shadowRoot?.querySelector(".product-container");
		if (!container) return;
		const child = container.firstElementChild as (HTMLElement & { refresh?: () => void }) | null;
		if (child) {
			if (this.showControls) child.setAttribute("data-show-controls", "");
			else child.removeAttribute("data-show-controls");
			child.refresh?.();
		}
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="product-container"></div>`;
	}
}

const STYLES = `
:host { display: block; min-height: 0; height: 100%; }
.product-container { height: 100%; }
`;
