import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { copyText } from "../controllers/clipboard-controller.js";
import { esc } from "../../util.js";
import { delay } from "../controllers/clock-controller.js";

/** How long the button reads Copied after a copy. */
const COPIED_MS = 1500;

/**
 * <shu-copy-button>: Standard "copy to clipboard" button used across shu views.
 *
 * Usage:
 *   <shu-copy-button label="Copy" .source=${someText}></shu-copy-button>
 *
 * For dynamic source set the `source` property directly or use `setSource()`.
 * The button shows a brief "Copied" confirmation after a successful write.
 */
export class ShuCopyButton extends HTMLElement {
	private _source = "";
	private _label = "Copy";
	private _copied = false;
	/** Cancels the delay after which the button reads Copy again. */
	private _cancelReset: (() => void) | undefined;

	connectedCallback(): void {
		if (!this.shadowRoot) this.attachShadow({ mode: "open" });
		const labelAttr = this.getAttribute("label");
		if (labelAttr) this._label = labelAttr;
		const titleAttr = this.getAttribute("title");
		if (titleAttr) this._titleAttr = titleAttr;
		this.render();
	}

	disconnectedCallback(): void {
		this._cancelReset?.();
		this._cancelReset = undefined;
	}

	private _titleAttr = "Copy to clipboard";

	set source(value: string) {
		this._source = value;
	}
	get source(): string {
		return this._source;
	}

	setSource(value: string): void {
		this._source = value;
	}

	/** Lazy source: computed at click time, for content that is slow to serialize (a graph view), never per render. */
	sourceProvider: (() => string) | null = null;

	private async copy(): Promise<void> {
		if (this.sourceProvider) this._source = this.sourceProvider();
		if (!(await copyText(this._source))) return;
		this._copied = true;
		this.render();
		this._cancelReset?.();
		this._cancelReset = delay(COPIED_MS, () => {
			this._copied = false;
			this._cancelReset = undefined;
			this.render();
		});
	}

	private render(): void {
		if (!this.shadowRoot) return;
		const text = this._copied ? "Copied" : this._label;
		this.shadowRoot.innerHTML = `<style>${STYLES}</style><button title="${esc(this._titleAttr)}" type="button">${esc(text)}</button>`;
		const btn = this.shadowRoot.querySelector("button");
		btn?.addEventListener("click", () => void this.copy());
	}
}

const STYLES = `
	:host { display: inline-block; }
	button {
		padding: 3px var(--shu-space-4);
		font-size: var(--shu-font-sm);
		font-family: inherit;
		background: var(--shu-bg-soft);
		color: var(--shu-fg);
		border: var(--shu-border-w) solid var(--shu-border);
		border-radius: var(--shu-radius);
		cursor: pointer;
	}
	button:hover { background: var(--shu-bg-hover); }
	button:focus-visible { outline: 2px solid var(--shu-accent); outline-offset: 1px; }
`;

defineElement(SHU_TAG.COPY_BUTTON, ShuCopyButton);
