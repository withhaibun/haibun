/**
 * The failures of the run being read, listed beside the bar that marks where they fall.
 *
 * A mark says which division of the run holds a failure; this says which failures those are. A row names the step that
 * failed or the message that reported an error, says why, and moves the shared cursor to that moment when it is
 * pressed, so every open view scrubs to the failure a reader chose.
 *
 * It draws what it is given, as the bar does: the reading belongs to whoever gives the rows. A run that failed nothing
 * draws nothing rather than an empty list.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { eventMarkerStyle } from "../event-marker.js";
import type { TRunRow } from "../client-cache/run-window.js";
import type { TLinkedData } from "@haibun/core/lib/hypermedia.js";

const EmptySchema = z.object({});
const IDS = SHU_TEST_IDS.FAILURES;

/** How a row of a run is marked, which is the mark its division carries on the bar. */
const markOf = (row: TRunRow): { color: string; icon: string } => eventMarkerStyle(row.kind === "step" ? { kind: "lifecycle", type: "step", stage: "end", status: row.status } : { kind: "log", level: row.level });

export class ShuRunFailures extends ShuElement<typeof EmptySchema> {
	/** The failures to list, newest first. */
	accessor rows: TRunRow[] = [];

	static properties = { rows: { attribute: false } };

	static styles = [
		shuBaseStyles,
		css`
			:host { display: block; }
			/* One line beside the bar until a reader opens it: the page's top belongs to the run, not to a list of what
			   failed in it. The disclosure is the browser's own, so it opens and closes as a reader expects. */
			summary { cursor: pointer; padding: 0 var(--shu-space-2); font-size: var(--shu-font-sm); color: var(--shu-fg-muted); }
			ol { list-style: none; margin: 0; padding: 0; max-height: 12em; overflow: auto; }
			li { display: flex; gap: var(--shu-space-2); align-items: baseline; font-size: var(--shu-font-sm); }
			button { font: inherit; color: inherit; background: none; border: none; padding: 0 var(--shu-space-2); cursor: pointer; text-align: left; display: flex; gap: var(--shu-space-2); width: 100%; }
			button:hover { background: var(--shu-bg-elevated); }
			.what { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.why { color: var(--shu-fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		`,
	];

	constructor() {
		super(EmptySchema, {});
	}

	/** What the run failed at, as a reader reads it: how many, and what each one said. */
	summarizeForKihan(): TLinkedData | null {
		if (this.rows.length === 0) return null;
		return {
			"@id": "view:run-failures",
			"@type": "as:OrderedCollection",
			name: `${this.rows.length} failures of the run`,
			totalItems: this.rows.length,
			items: this.rows.map((row) => ({ "@type": "as:Note", name: row.text, content: row.error ?? "", startTime: new Date(row.at).toISOString() })),
		};
	}

	render(): TemplateResult {
		if (this.rows.length === 0) return html``;
		return html`<details data-testid=${IDS.ROOT}>
			<summary data-testid=${IDS.COUNT}>${this.rows.length} failed</summary>
			<ol>
				${this.rows.map((row) => {
					const mark = markOf(row);
					return html`<li>
						<button
							data-testid=${`${IDS.ROW}${row.id}`}
							title=${`${new Date(row.at).toISOString()}: ${row.error ?? row.text}`}
							@click=${() => {
								this.timeCursor = row.at;
							}}
						>
							<span style=${`color:${mark.color}`}>${mark.icon}</span>
							<span class="what">${row.text}</span>
							<span class="why">${row.error ?? ""}</span>
						</button>
					</li>`;
				})}
			</ol>
		</details>`;
	}
}
