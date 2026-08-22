/**
 * <shu-window-size> — the window-size picker, bound to the ONE global `windowSizeSetting` (window-size-setting.ts, the
 * setting's home, read by the run sources and the graph query). The current value is read reactively from the shared
 * signal, so every mounted picker stays in step.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { SHU_TAG } from "../consts.js";
import { WINDOW_SIZES, windowSizeSetting } from "../window-size-setting.js";

const EmptySchema = z.object({});

export class ShuWindowSize extends ShuElement<typeof EmptySchema> {
	/** A control, not a view of data — contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static schema = EmptySchema;
	static domainSelector = SHU_TAG.WINDOW_SIZE;

	static styles = [
		shuBaseStyles,
		css`
		:host { display: inline-flex; align-items: center; font-size: var(--shu-font-sm); user-select: none; }
		.group {
			display: inline-flex;
			border: var(--shu-border-w) solid var(--shu-border);
			border-radius: var(--shu-radius);
			overflow: hidden;
		}
		.group > button {
			padding: var(--shu-space-1) var(--shu-space-3);
			background: transparent;
			color: var(--shu-fg-muted);
			border: none;
			border-left: var(--shu-border-w) solid var(--shu-border);
			cursor: pointer;
			font: inherit; font-size: var(--shu-font-sm);
			min-width: 24px;
		}
		.group > button:first-child { border-left: none; }
		.group > button[aria-pressed="true"] { background: var(--shu-accent); color: var(--shu-accent-fg); }
		.group > button:hover:not([aria-pressed="true"]) { background: var(--shu-bg-hover); color: var(--shu-fg); }
	`,
	];

	constructor() {
		super(EmptySchema, {});
	}

	render(): TemplateResult {
		const current = windowSizeSetting.get(); // reactive: any picker (or the setting itself) changing re-renders this one
		return html`<span class="group" role="group" aria-label="Window size" data-testid="settings-window-size">
			${WINDOW_SIZES.map((w) => html`<button type="button" data-value=${w.value} aria-pressed=${w.value === current} @click=${() => windowSizeSetting.set(w.value)}>${w.label}</button>`)}
		</span>`;
	}
}

customElements.define(SHU_TAG.WINDOW_SIZE, ShuWindowSize);
