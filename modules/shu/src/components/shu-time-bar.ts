/**
 * A bar a reader reads the shape of a span of a run from: one mark per division of that span that holds anything.
 *
 * A run of any length draws the same way, because the bar is given divisions rather than records. It draws what it is
 * given and says which of its divisions was pressed; what the marks are, what span they cover and where a press moves
 * the reader belong to whoever gives them, so the bar can be read on its own.
 *
 * A page draws one of these per span it shows: the whole run, and the region around where a reader is. Each is its own
 * line, at its own scale, so a position on a line means one thing rather than two.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import type { TRunMark } from "../client-cache/run-marks.js";
import type { TLinkedData } from "@haibun/core/lib/hypermedia.js";

/** Which span this bar draws, which is also what names it and its marks for a reader reading them back. */
export const TIME_BAR_SPANS = ["run", "detail"] as const;
const ShuTimeBarSchema = z.object({ span: z.enum(TIME_BAR_SPANS) });

export class ShuTimeBar extends ShuElement<typeof ShuTimeBarSchema> {
	static styles = [
		css`
			:host { display: block; position: relative; height: var(--shu-space-5, 20px); }
			.span { position: absolute; inset: 0; border-top: 1px solid var(--shu-border, #d4d4d8); }
			.mark { position: absolute; top: 50%; transform: translate(-50%, -50%); background: none; border: none; padding: 0; cursor: pointer; font-size: var(--shu-font-sm); line-height: 1; }
		`,
	];

	/** The marks to draw, each naming the division it belongs to. */
	accessor marks: TRunMark[] = [];
	/** How many divisions the span has, which is what places a mark along it. */
	accessor divisions = 0;

	static attributeFields = { span: "span" };

	constructor() {
		super(ShuTimeBarSchema, { span: "run" });
	}

	/** The run's shape as this bar draws it: which divisions hold something and what each marks as, which is what a
	 *  reader sees of a run of any length. */
	summarizeForKihan(): TLinkedData | null {
		if (this.marks.length === 0) return null;
		return {
			"@id": `view:run-shape-${this.state.span}`,
			"@type": "as:Collection",
			name: `the shape of the ${this.state.span} in ${this.divisions} divisions`,
			content: this.marks.map((mark) => `${mark.division}: ${mark.icon}`).join(", "),
		};
	}

	static properties = { marks: { attribute: false }, divisions: { attribute: false } };

	/** Where along the span a division sits, as a percentage: its middle, so the first and last are inside the bar. */
	#leftOf(division: number): number {
		return this.divisions > 0 ? ((division + 0.5) / this.divisions) * 100 : 0;
	}

	override render(): TemplateResult {
		const span = this.state.span;
		return html`<div class="span" data-testid=${`${SHU_TEST_IDS.TIME_BAR.ROOT}${span}`}>
			${this.marks.map(
				(mark) => html`<button
					class="mark"
					data-testid=${`${SHU_TEST_IDS.TIME_BAR.MARK}${span}-${mark.division}`}
					style=${`left:${this.#leftOf(mark.division)}%;color:${mark.color}`}
					title=${`division ${mark.division} of ${this.divisions} of the ${span}`}
					@click=${() => this.dispatchEvent(new CustomEvent(SHU_EVENT.TIME_BAR_PRESS, { detail: { division: mark.division }, bubbles: true, composed: true }))}
				>
					${mark.icon}
				</button>`,
			)}
		</div>`;
	}
}
