/**
 * <shu-window-size>: the window-size picker, bound to the ONE global `windowSizeSetting` (window-size-setting.ts, the
 * setting's home, read by the run sources and the graph query). The current value is read reactively from the shared
 * signal, so every mounted picker stays in step.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles, shuSegmentedStyles } from "./styles.js";
import { SHU_TAG } from "../consts.js";
import { WINDOW_SIZES, windowSizeSetting } from "../window-size-setting.js";

const EmptySchema = z.object({});

class ShuWindowSize extends ShuElement<typeof EmptySchema> {
	/** A control, not a view of data, contributes nothing to the Kihan's context. */
	summarizeForKihan(): TLinkedData | null {
		return null;
	}

	static schema = EmptySchema;
	static domainSelector = SHU_TAG.WINDOW_SIZE;

	static styles = [
		shuBaseStyles,
		shuSegmentedStyles,
		css`
		:host { display: inline-flex; align-items: center; font-size: var(--shu-font-sm); user-select: none; }
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
