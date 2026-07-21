import { copyText } from "../copy-util.js";

/**
 * <shu-copy-button> — Standard "copy to clipboard" button used across shu views.
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
	private _resetTimer: number | null = null;

	connectedCallback(): void {
		if (!this.shadowRoot) this.attachShadow({ mode: "open" });
		const labelAttr = this.getAttribute("label");
		if (labelAttr) this._label = labelAttr;
		const titleAttr = this.getAttribute("title");
		if (titleAttr) this._titleAttr = titleAttr;
		this.render();
	}

	disconnectedCallback(): void {
		if (this._resetTimer !== null) {
			window.clearTimeout(this._resetTimer);
			this._resetTimer = null;
		}
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

	/** Lazy source: computed at click time, for content that is expensive to serialize (a graph view) — never per render. */
	sourceProvider: (() => string) | null = null;

	private async copy(): Promise<void> {
		if (this.sourceProvider) this._source = this.sourceProvider();
		// copyText falls back to execCommand when the async Clipboard API is blocked/absent (e.g. a file:// report).
		if (!(await copyText(this._source))) return;
		this._copied = true;
		this.render();
		if (this._resetTimer !== null) window.clearTimeout(this._resetTimer);
		this._resetTimer = window.setTimeout(() => {
			this._copied = false;
			this._resetTimer = null;
			this.render();
		}, 1500);
	}

	private render(): void {
		if (!this.shadowRoot) return;
		const text = this._copied ? "Copied" : this._label;
		this.shadowRoot.innerHTML = `<style>${STYLES}</style><button title="${this._titleAttr}" type="button">${text}</button>`;
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
