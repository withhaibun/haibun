/**
 * <shu-spinner>: what a view waits for, as text beside a turning dot. The dot pulses at each new status, so a reader sees
 * the wait advance.
 */
import { html, css, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { ShuElement, EmptyStateSchema, type TLinkedData } from "./shu-element.js";

export class ShuSpinner extends ShuElement<typeof EmptyStateSchema> {
	/** A spinner is part of the view that shows it, so it doesn't contribute to a conversation's context on its own. */
	summarizeForContext(): TLinkedData | null {
		return null;
	}

	static styles = css`
		:host { display: block; }
		.spinner-container { display: flex; align-items: center; gap: var(--shu-space-3); padding: var(--shu-space-1) 0; color: var(--shu-fg-muted); font-style: italic; font-size: inherit; }
		.spinner-container[hidden] { display: none; }
		.spinner-dot { width: 12px; height: 12px; border: 2px solid var(--shu-border); border-top-color: var(--shu-fg-muted); border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0; }
		.spinner-dot.still { animation: none; }
		.spinner-dot.pulse { animation: spin 0.8s linear infinite, ping 0.4s ease-out; }
		@keyframes spin { to { transform: rotate(360deg); } }
		@keyframes ping { 0% { box-shadow: 0 0 0 0 rgba(85,85,85,0.5); } 100% { box-shadow: 0 0 0 6px rgba(85,85,85,0); } }
		.spinner-status { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	`;

	/** The wait the spinner states. */
	@property() accessor status = "";
	/** Whether the spinner shows. */
	@property({ type: Boolean }) accessor visible = false;
	/** Whether the dot turns; a wait that has stopped shows a still dot. */
	@property({ type: Boolean }) accessor spinning = true;

	constructor() {
		super(EmptyStateSchema);
	}

	/** Restarts the dot's pulse at each new status. */
	protected override updated(changed: Map<PropertyKey, unknown>): void {
		if (!changed.has("status") || !this.spinning) return;
		const dot = this.shadowRoot?.querySelector(".spinner-dot");
		if (!(dot instanceof HTMLElement)) throw new Error("<shu-spinner> doesn't render its dot");
		dot.classList.remove("pulse");
		// A reflow between the removal and the addition restarts the animation.
		void dot.offsetWidth;
		dot.classList.add("pulse");
	}

	render(): TemplateResult {
		return html`<div class="spinner-container" ?hidden=${!this.visible}><div class=${this.spinning ? "spinner-dot" : "spinner-dot still"}></div><span class="spinner-status">${this.status}</span></div>`;
	}
}

defineElement(SHU_TAG.SPINNER, ShuSpinner);
