/**
 * <shu-product-view> — Unified product renderer.
 * Resolves the product's type to a single component (resolveUi) and mounts it; each component takes the
 * product via openProducts(), or self-fetches (the _component views: graph/monitor/sequence). One path,
 * no shape-sniffing.
 *
 * The mounted component lives in LIGHT DOM (slot-projected), never in this element's shadow root: a WebXR/A-Frame
 * presenter resolves its own camera and UI anchors through document.querySelector, which cannot see into a shadow
 * root — mounted there, its scene boots but its graph component dies on the camera lookup. Light DOM keeps the
 * mounted subtree document-reachable wherever the product view is embedded.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { resolveUi } from "../resolve-ui.js";
import { ensureUiComponentLoaded } from "../external-components.js";

const ProductViewSchema = z.object({});

export class ShuProductView extends ShuElement<typeof ProductViewSchema> {
	/** Delegates to the mounted child view: the wrapper summarizes for its whole subtree. */
	summarizeForKihan(): TLinkedData | null {
		const child = this.firstElementChild as (Element & Partial<{ summarizeForKihan(): TLinkedData | null }>) | null;
		return child?.summarizeForKihan?.() ?? null;
	}

	static styles = [
		shuBaseStyles,
		css`
		:host { display: block; min-height: 0; height: 100%; }
		::slotted(*) { height: 100%; }
	`,
	];

	constructor() {
		super(ProductViewSchema, {});
	}

	/** Mount the component resolveUi picks for this product and hand it the product. A _component view ignores the
	 * product and self-fetches. A site-declared component (ui:{component,js}) is fetched through the shared loader
	 * first, so an embedded product view mounts identically to a column pane — never depending on some pane having
	 * loaded the bundle already. */
	openProducts(products: Record<string, unknown>, snapshotTime?: number): void {
		this.replaceChildren();
		const tag = resolveUi(products).component;
		if (!customElements.get(tag)) {
			void ensureUiComponentLoaded(tag)
				.then(() => this.mountProduct(tag, products, snapshotTime))
				.catch((err) => {
					this.textContent = `failed to load ${tag}: ${err instanceof Error ? err.message : String(err)}`;
				});
			return;
		}
		this.mountProduct(tag, products, snapshotTime);
	}

	private mountProduct(tag: string, products: Record<string, unknown>, snapshotTime?: number): void {
		const el = document.createElement(tag);
		if (snapshotTime !== undefined) el.setAttribute("data-snapshot-time", String(snapshotTime));
		if (this.showControls) el.setAttribute("data-show-controls", "");
		el.style.minHeight = "300px";
		el.style.height = "100%";
		el.style.display = "block";
		this.appendChild(el);
		requestAnimationFrame(() => (el as { openProducts?: (p: Record<string, unknown>, t?: number) => void }).openProducts?.(products, snapshotTime));
	}

	override refresh(): void {
		const child = this.firstElementChild as (HTMLElement & { refresh?: () => void }) | null;
		if (!child) return;
		if (this.showControls) child.setAttribute("data-show-controls", "");
		else child.removeAttribute("data-show-controls");
		child.refresh?.();
	}

	render(): TemplateResult {
		return html`<slot></slot>`;
	}
}
