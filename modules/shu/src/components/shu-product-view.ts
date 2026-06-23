/**
 * <shu-product-view> — Unified product renderer.
 * Resolves the product's type to a single component (resolveUi) and mounts it; each component takes the
 * product via openProducts(), or self-fetches (the _component views: graph/monitor/sequence). One path,
 * no shape-sniffing.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { resolveUi } from "../resolve-ui.js";

const ProductViewSchema = z.object({});

export class ShuProductView extends ShuElement<typeof ProductViewSchema> {
	static styles = [
		shuBaseStyles,
		css`
		:host { display: block; min-height: 0; height: 100%; }
		.product-container { height: 100%; }
	`,
	];

	constructor() {
		super(ProductViewSchema, {});
	}

	/** Mount the component resolveUi picks for this product and hand it the product. The imperative mount lives inside
	 * the stable .product-container so it survives Lit re-renders. A _component view ignores the product and self-fetches. */
	openProducts(products: Record<string, unknown>, snapshotTime?: number): void {
		const container = this.shadowRoot?.querySelector(".product-container") as HTMLElement | null;
		if (!container) return;
		container.replaceChildren();
		const el = document.createElement(resolveUi(products).component);
		if (snapshotTime !== undefined) el.setAttribute("data-snapshot-time", String(snapshotTime));
		if (this.showControls) el.setAttribute("data-show-controls", "");
		el.style.minHeight = "300px";
		el.style.height = "100%";
		el.style.display = "block";
		container.appendChild(el);
		requestAnimationFrame(() => (el as { openProducts?: (p: Record<string, unknown>, t?: number) => void }).openProducts?.(products, snapshotTime));
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
