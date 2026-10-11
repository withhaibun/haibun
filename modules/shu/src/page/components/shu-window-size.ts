/**
 * <shu-window-size>: the picker of how many rows a windowed read returns. It stores its choice under its tag, so every
 * picker on the page shows the same choice, and actuality's sources and the graph query read it by the tag.
 */
import { html, css, type TemplateResult } from "lit";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles, shuSegmentedStyles } from "./styles.js";
import { SHU_TAG } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { INITIAL_WINDOW_SIZE, PAGE_SETTING_KEY, WINDOW_SIZES, WindowSizeSchema } from "../domains/settings.js";

class ShuWindowSize extends ShuElement<typeof WindowSizeSchema> {
	/** A control doesn't contribute to a conversation's context, since it isn't a view of data. */
	summarizeForContext(): TLinkedData | null {
		return null;
	}

	static domainSelector = SHU_TAG.WINDOW_SIZE;
	static persistFields = ["rows"] as const;

	static styles = [
		shuBaseStyles,
		shuSegmentedStyles,
		css`
		:host { display: inline-flex; align-items: center; font-size: var(--shu-font-sm); user-select: none; }
	`,
	];

	constructor() {
		super(WindowSizeSchema, INITIAL_WINDOW_SIZE);
	}

	protected override get persistKey(): string {
		return PAGE_SETTING_KEY;
	}

	render(): TemplateResult {
		const { rows } = this.state;
		return html`<span class="group" role="group" aria-label="Window size" data-testid="settings-window-size">
			${WINDOW_SIZES.map((w) => html`<button type="button" data-value=${w.value} aria-pressed=${w.value === rows} @click=${() => this.setState({ rows: w.value })}>${w.label}</button>`)}
		</span>`;
	}
}

defineElement(SHU_TAG.WINDOW_SIZE, ShuWindowSize);
