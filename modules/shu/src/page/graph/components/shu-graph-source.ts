/**
 * shu-graph-source: the source a graph view reads its graph as, beside the scene: each line of the source in its own notation,
 * with the statement and the record behind it on hover, the summary of the source's kinds, the format it reads, and a copy and a
 * download of its text. The lines and the scene select each other through the host: a reader's line lights the nodes and edges
 * it states, and the lines that state what a reader chose in the scene light here. A reader moves through the lines with the
 * arrow keys, Home and End, and lets the line go with Escape or a second press.
 *
 * It doesn't own state: the host reads the projection, holds the reader's line and the lit lines, and hands them down. This
 * element renders what it is given and reports the reader's intent through `onLine` and `onFormat`.
 */
import { css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import type { TProjection } from "@haibun/logic/domains/logic.js";
import { SHU_TAG } from "../../../domains/elements.js";
import { SHU_TEST_IDS } from "../../../domains/test-ids.js";
import { defineElement } from "../../controllers/element-controller.js";
import { saveFile } from "../../controllers/file-controller.js";
import { EmptyStateSchema, ShuElement, type TLinkedData } from "../../components/shu-element.js";
import { shuBaseStyles } from "../../components/styles.js";
import { revealInDocument } from "../../components/reveal.js";
import "../../components/shu-copy-button.js";
import { SOURCE_FORMATS, type TSourceFormat } from "../domains/sources.js";
import { lineAfterKey, provenanceOf, statusOf, summaryOf, type TSceneSelection } from "../derivations/source-lines.js";

/** The id of a line's element, which the list names as its active descendant. */
const lineId = (name: string): string => `line-${name}`;

class ShuGraphSource extends ShuElement<typeof EmptyStateSchema> {
	/** The host summarises the graph a reader reads, so its source doesn't summarise it twice. */
	summarizeForContext(): TLinkedData | null {
		return null;
	}

	static properties = {
		projection: { attribute: false },
		format: { attribute: false },
		lit: { attribute: false },
		line: { attribute: false },
		lights: { attribute: false },
		onLine: { attribute: false },
		onFormat: { attribute: false },
	};

	// `declare`, never a class field: a field would shadow lit's reactive accessor (lit.dev/msg/class-field-shadowing).
	/** The source the host read. */
	declare projection: TProjection;
	/** The format the source reads as. */
	declare format: TSourceFormat;
	/** The lines that state what the reader chose in the scene. */
	declare lit: ReadonlySet<string>;
	/** The line the reader is on, which lights what it states in the scene. */
	declare line: string | null;
	/** What the reader's line lights in the scene, by the scene's ids, or null where the reader isn't on a line. */
	declare lights: TSceneSelection | null;
	/** Reports the line a reader moved to, or null where the reader let it go. */
	declare onLine: (line: string | null) => void;
	/** Reports the format a reader chose. */
	declare onFormat: (id: string) => void;

	static styles = [
		shuBaseStyles,
		css`
			:host { display: flex; flex-direction: column; min-height: 0; border-top: var(--shu-border-w) solid var(--shu-border); background: var(--shu-bg); }
			.head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--shu-space-3); padding: var(--shu-space-1) var(--shu-space-3); font-size: var(--shu-font-sm); color: var(--shu-fg-muted); }
			[role="status"] { flex: 1 1 auto; }
			ol { flex: 1 1 auto; overflow: auto; margin: 0; padding: var(--shu-space-1) 0; list-style: none; outline-offset: -2px; }
			li { white-space: pre-wrap; padding: 0 var(--shu-space-3); cursor: pointer; }
			li:hover { background: var(--shu-bg-hover); }
			li.lit { background: var(--shu-accent-soft); }
			li[aria-selected="true"] { background: var(--shu-accent); color: var(--shu-accent-fg); }
			.name { display: inline-block; min-width: 5ch; color: var(--shu-fg-faded); }
			.predicate { color: var(--shu-pred); }
			.variable { font-style: italic; }
			.symbol { color: var(--shu-fg-muted); }
			li[aria-selected="true"] span { color: inherit; }
		`,
	];

	constructor() {
		super(EmptyStateSchema);
		this.lit = new Set();
		this.line = null;
		this.lights = null;
		this.onLine = () => {
			throw new Error("shu-graph-source reports a reader's line to its host: set .onLine");
		};
		this.onFormat = () => {
			throw new Error("shu-graph-source reports a reader's format to its host: set .onFormat");
		};
	}

	override render(): TemplateResult {
		const { projection, format, line } = this;
		const file = `graph.${format.extension}`;
		return html`<div class="head">
				<select aria-label="source format" .value=${format.id} @change=${(e: Event) => this.onFormat((e.target as HTMLSelectElement).value)}>
					${SOURCE_FORMATS.map(({ id, label }) => html`<option value=${id} ?selected=${id === format.id}>${label}</option>`)}
				</select>
				<span>${summaryOf(projection.summary)}</span>
				<span role="status">${statusOf(line, this.lights, this.lit)}</span>
				<shu-copy-button label="⧉" title=${`copy the ${format.label} text to the clipboard`} .source=${projection.text}></shu-copy-button>
				<button type="button" title=${`download the ${format.label} text as ${file}`} @click=${() => saveFile(projection.text, file)}>⤓</button>
			</div>
			<ol
				role="listbox"
				tabindex="0"
				data-testid=${SHU_TEST_IDS.POLYMORPHIC_VIEW.SOURCE_LINES}
				aria-label=${`the graph as ${format.label}`}
				aria-activedescendant=${line === null ? nothing : lineId(line)}
				@keydown=${this.onKey}
				@click=${this.onPress}
			>
				${projection.formulas.map(
					(formula) =>
						html`<li role="option" id=${lineId(formula.name)} data-name=${formula.name} aria-selected=${formula.name === line} class=${this.lit.has(formula.name) ? "lit" : ""} title=${provenanceOf(formula)}><span class="name">${formula.name}</span>${formula.tokens.map(({ text, role }) => html`<span class=${role}>${text}</span>`)}</li>`,
				)}
			</ol>`;
	}

	/** A press on a line moves the reader to it, and a press on the reader's own line lets it go. */
	private onPress = (e: Event): void => {
		const name = (e.target as Element).closest("li")?.getAttribute("data-name");
		if (name) this.onLine(name === this.line ? null : name);
	};

	/** The arrow keys, Home and End move the reader through the lines, and Escape lets the line go. */
	private onKey = (e: KeyboardEvent): void => {
		const names = this.projection.formulas.map(({ name }) => name);
		const next = e.key === "Escape" ? null : lineAfterKey(names, this.line, e.key);
		if (next === undefined) return;
		e.preventDefault();
		this.onLine(next);
	};

	/** The reader's line, or the first line the scene lights, stays in view as it changes. */
	protected override updated(changed: PropertyValues<this>): void {
		if (!changed.has("line") && !changed.has("lit")) return;
		const shown = this.renderRoot.querySelector(this.line === null ? "li.lit" : 'li[aria-selected="true"]');
		if (shown !== null) revealInDocument(shown, { block: "nearest", inline: "nearest", behavior: "auto" });
	}
}

defineElement(SHU_TAG.GRAPH_SOURCE, ShuGraphSource);
