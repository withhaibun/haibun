/**
 * <shu-copy-button>: a button that copies text to the clipboard, and reads Copied for a moment after a copy. Its text is
 * `source`, or what `sourceProvider` returns at the press, for text that is slow to build, such as a graph's.
 */
import { html, css, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { copyText } from "../controllers/clipboard-controller.js";
import { delay } from "../controllers/clock-controller.js";
import { ShuElement, EmptyStateSchema, type TLinkedData } from "./shu-element.js";

/** How long the button reads Copied after a copy. */
const COPIED_MS = 1500;

export class ShuCopyButton extends ShuElement<typeof EmptyStateSchema> {
	/** A control doesn't contribute to the Kihan's context, since it isn't a view of data. */
	summarizeForContext(): TLinkedData | null {
		return null;
	}

	static styles = css`
		:host { display: inline-block; }
		button { padding: 3px var(--shu-space-4); font-size: var(--shu-font-sm); font-family: inherit; cursor: pointer; }
	`;

	/** What the button reads. */
	@property() accessor label = "";
	/** The text a press copies. */
	@property({ attribute: false }) accessor source = "";
	/** Returns the text a press copies, at the press, in place of `source`. */
	@property({ attribute: false }) accessor sourceProvider: (() => string) | undefined = undefined;
	@state() private accessor copied = false;
	/** Cancels the delay after which the button reads its label again. */
	#cancelReset: (() => void) | undefined;

	constructor() {
		super(EmptyStateSchema);
	}

	protected override onDisconnected(): void {
		this.#cancelReset?.();
		this.#cancelReset = undefined;
	}

	private async copy(): Promise<void> {
		if (!(await copyText(this.sourceProvider === undefined ? this.source : this.sourceProvider()))) return;
		this.copied = true;
		this.#cancelReset?.();
		this.#cancelReset = delay(COPIED_MS, () => {
			this.copied = false;
			this.#cancelReset = undefined;
		});
	}

	render(): TemplateResult {
		if (this.label === "") throw new Error("<shu-copy-button> renders without a label");
		return html`<button type="button" title=${this.title} @click=${() => void this.copy()}>${this.copied ? "Copied" : this.label}</button>`;
	}
}

defineElement(SHU_TAG.COPY_BUTTON, ShuCopyButton);
