/**
 * <shu-product-view> — Unified product renderer.
 * Inspects product shape and delegates to the appropriate view component:
 *   _component → live web component (graph, sequence, monitor)
 *   items[]    → shu-thread-column (flat/tree/graph views with relations)
 *   otherwise  → shu-entity-column (field table for single entities)
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import type { ShuThreadColumn } from "./shu-thread-column.js";
import type { ShuEntityColumn } from "./shu-entity-column.js";

const ProductViewSchema = z.object({});

type ThreadVertex = Record<string, unknown> & { _edges?: { type: string; targetId: string }[] };

function normalizeItem(item: Record<string, unknown>): ThreadVertex {
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
	return { ...item, ...(_edges.length ? { _edges } : {}) };
}

export class ShuProductView extends ShuElement<typeof ProductViewSchema> {
	static styles = [shuBaseStyles, css`
		:host { display: block; min-height: 0; height: 100%; }
		.product-container { height: 100%; }
	`];

	constructor() {
		super(ProductViewSchema, {});
	}

	/** Render products using the appropriate view component. Imperative DOM mount survives across Lit re-renders by living inside the
	 * .product-container element which Lit keeps stable. */
	openProducts(products: Record<string, unknown>, snapshotTime?: number): void {
		const container = this.shadowRoot?.querySelector(".product-container") as HTMLElement | null;
		if (!container) return;
		container.replaceChildren();

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
		if (!child) return;
		if (this.showControls) child.setAttribute("data-show-controls", "");
		else child.removeAttribute("data-show-controls");
		child.refresh?.();
	}

	render(): TemplateResult {
		return html`<div class="product-container"></div>`;
	}
}
