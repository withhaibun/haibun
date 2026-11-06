/**
 * <shu-ref>: a link to the view of a structured identifier (a seqPath, a record, a domain, a step or an action). Each panel
 * that shows one uses this element, so the links read one way: a panel writes `<shu-ref kind="…">` markup and doesn't wire
 * its own click handler. The link's href is the address of the referenced pane, which the page follows (`followPaneLink`),
 * opening it beside the pane that holds the link.
 *
 * Attributes, which `renderRef` and `refTpl` write:
 *   kind: "seqPath" | "entity" | "domain" | "step" | "action"
 *   linkTarget: JSON that names the target, by kind: `{ "seqPath": [0,1,2] }`, `{ "persistedAs": "Issuer", "id": "…" }`,
 *               `{ "domain": "…" }`, `{ "method": "…" }` or `{ "action": "…" }`
 *   text: the words the link shows
 */
import { html, css, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { JsonObjectTextSchema } from "@haibun/core/lib/domains/json-text.js";
import { LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { REF_DENOTES } from "@haibun/core/lib/domains/typed-links.js";
import type { TRecordStep } from "@haibun/core/lib/domains/hypermedia.js";
import { refHref } from "./ref-navigation.js";
import { refOf, type TRef } from "../derivations/markdown.js";
import { hasCatalog } from "../controllers/catalog-controller.js";
import { recordSteps } from "../controllers/registry-controller.js";
import { ShuElement, EmptyStateSchema, type TLinkedData } from "./shu-element.js";

export class ShuRef extends ShuElement<typeof EmptyStateSchema> {
	/** A reference is part of the view that shows it, so it doesn't contribute to a conversation's context on its own. */
	summarizeForContext(): TLinkedData | null {
		return null;
	}

	static styles = css`
		:host { display: inline; }
		:host([inline-image]) { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 4px; margin: 4px 0; }
		.ref-line { display: inline-flex; align-items: center; gap: 4px; }
		a { color: var(--shu-link); text-decoration: none; }
		a:hover { text-decoration: underline; }
		code { font-family: var(--shu-font-family); font-size: 0.95em; }
		.ref-download {
			display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; font-size: 0.85em;
			background: var(--shu-bg-input, #f0f0f0); color: var(--shu-fg, #222); border: 1px solid var(--shu-border, #ccc);
			border-radius: 3px; cursor: pointer; line-height: 1.2;
		}
		.ref-download:hover { background: var(--shu-bg-hover, #e0e0e0); }
		.ref-inline-image { max-width: min(100%, 360px); max-height: 260px; border-radius: 4px; border: 1px solid var(--shu-border, #ccc); object-fit: contain; }
	`;

	@property() accessor kind = "";
	@property({ attribute: "linktarget" }) accessor linkTarget = "";
	@property() accessor text = "";
	@property({ type: Boolean, attribute: "inline-image" }) accessor inlineImage = false;
	@state() private accessor imageUrl: string | undefined = undefined;
	#loadedImageKey = "";
	#blobUrl: string | undefined = undefined;

	constructor() {
		super(EmptyStateSchema);
	}

	protected override onDisconnected(): void {
		if (this.#blobUrl !== undefined) {
			URL.revokeObjectURL(this.#blobUrl);
			this.#blobUrl = undefined;
		}
	}

	private parsedRef(): TRef | undefined {
		const target = JsonObjectTextSchema.safeParse(this.linkTarget);
		return target.success ? refOf(this.kind, target.data) : undefined;
	}

	/** The content read step of the referenced individual, where the catalog offers one. */
	#contentStep(ref: TRef | undefined): TRecordStep | undefined {
		if (ref?.kind !== REF_DENOTES.individual || !hasCatalog()) return undefined;
		return recordSteps(ref.target.persistedAs, ref.target.id).find((s) => s.rel === LinkRelations.CONTENT.rel && s.asks === "read" && s.unboundCount === 0);
	}

	protected override updated(): void {
		const key = `${this.kind}:${this.linkTarget}:${String(this.inlineImage)}`;
		if (!this.inlineImage || key === this.#loadedImageKey) return;
		this.#loadedImageKey = key;
		void this.#loadInlineImage();
	}

	async #loadInlineImage(): Promise<void> {
		const step = this.#contentStep(this.parsedRef());
		if (step === undefined) return;
		const { loadStepImage } = await import("../controllers/file-controller.js");
		const url = await loadStepImage(step);
		if (url !== undefined) {
			if (this.#blobUrl !== undefined) URL.revokeObjectURL(this.#blobUrl);
			this.#blobUrl = url;
			this.imageUrl = url;
		}
	}

	#onDownload = async (e: Event): Promise<void> => {
		e.stopPropagation();
		e.preventDefault();
		const step = this.#contentStep(this.parsedRef());
		if (step === undefined) return;
		const { downloadStep } = await import("../controllers/file-controller.js");
		await downloadStep(step);
	};

	render(): TemplateResult {
		if (this.kind === "" || this.linkTarget === "") throw new Error("<shu-ref> renders without its kind and its linkTarget, which renderRef and refTpl write");
		const ref = this.parsedRef();
		const href = ref === undefined ? undefined : refHref(ref);
		const code = html`<code>${this.text}</code>`;
		const link = href === undefined ? code : html`<a href=${href}>${code}</a>`;
		const downloadable = this.#contentStep(ref) !== undefined;
		const downloadBtn = downloadable
			? html`<button type="button" class="ref-download" data-testid="shu-ref-download" title=${`Download ${this.text}`} aria-label=${`Download ${this.text}`} @click=${this.#onDownload}>⬇</button>`
			: nothing;
		const image =
			this.inlineImage && this.imageUrl !== undefined ? html`<img class="ref-inline-image" data-testid="shu-ref-image" src=${this.imageUrl} alt=${this.text} />` : nothing;
		return downloadable || image !== nothing ? html`${image}<span class="ref-line">${link}${downloadBtn}</span>` : link;
	}
}

defineElement(SHU_TAG.REF, ShuRef);
