/**
 * shu-graph-source: the axioms of what a graph view shows, in a pane of its own: each frame in Manchester syntax, with its
 * axioms in DL notation, the statement and the record behind it on hover, the summary of the source's kinds, the format it
 * reads, and a copy and a download of its text. A line that states a record or a class links to its pane, and the lines that
 * state the record a reader is on light. A reader moves through the lines with the arrow keys, Home and End, and lets the
 * line go with Escape or a second press.
 *
 * The pane shows what `show axioms of {view}` returned, which a graph view's ¶ control and a node or an edge chosen in its DL
 * view open it with, the latter at the frame that states it. It holds the view the axioms state, so it reads that view again
 * in another format.
 */
import { css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { z } from "zod";
import { FRAME_KIND, type TFrame } from "@haibun/core/lib/records/domains/axioms.js";
import { SHU_TAG } from "../../../domains/elements.js";
import { SHU_TEST_IDS } from "../../../domains/test-ids.js";
import { ViewAxiomsProductsSchema, type TViewAxioms } from "../../../domains/graph-view.js";
import { defineElement } from "../../controllers/element-controller.js";
import { saveFile } from "../../controllers/file-controller.js";
import { LoadController } from "../../controllers/load-controller.js";
import { callStep } from "../../controllers/read-controller.js";
import type { TCallOutcome } from "../../pipelines/call-step.js";
import { SubjectController } from "../../controllers/subject-controller.js";
import { ShuElement, type TLinkedData } from "../../components/shu-element.js";
import { shuBaseStyles } from "../../components/styles.js";
import { revealInDocument } from "../../components/reveal.js";
import { paneHref } from "../../components/ref-navigation.js";
import "../../components/shu-copy-button.js";
import "../../components/shu-refusal.js";
import { SOURCE_FORMATS, SOURCE_FORMAT_IDS, sourceFormat } from "../domains/sources.js";
import { lineAfterKey, linesOf, provenanceOf, statusOf, summaryOf } from "../derivations/source-lines.js";

/** What the pane is given: the axioms of a view, the view, and the frame it opens at first. A step's products carry hypermedia
 *  markers beside them, which the pane doesn't read. */
export const GraphSourcePaneSchema = ViewAxiomsProductsSchema.extend({ line: z.string().optional() });
export type TGraphSourcePane = z.input<typeof GraphSourcePaneSchema>;

const GraphSourceStateSchema = z.object({ format: z.enum(SOURCE_FORMAT_IDS) });

/** The id of a line's element, which the list names as its active descendant. */
const lineId = (name: string): string => `line-${encodeURIComponent(name)}`;

/** A link to the pane a frame's term opens: an individual's record, or a class's type. A property doesn't have a pane of its own. */
function termRef({ kind, assertedBy, name }: TFrame): TemplateResult | typeof nothing {
	if (kind === FRAME_KIND.individual && assertedBy !== undefined)
		return html`<a href=${paneHref({ paneType: "entity", ...assertedBy })} title=${`open ${assertedBy.persistedAs} ${assertedBy.id}`}>↗</a>`;
	const type = name.slice(FRAME_KIND.class.length + 1);
	return kind === FRAME_KIND.class ? html`<a href=${paneHref({ paneType: "type", persistedAs: type })} title=${`open the type ${type}`}>↗</a>` : nothing;
}

class ShuGraphSource extends ShuElement<typeof GraphSourceStateSchema> {
	static persistFields = ["format"] as const;

	/** The axioms a reader reads, as the pane holds them now. */
	summarizeForContext(): TLinkedData | null {
		const axioms = this.#axioms.page;
		return axioms === undefined
			? null
			: { "@id": "view:graph-axioms", "@type": "as:Document", name: "the axioms of what a graph view shows, in Manchester syntax", content: axioms.text };
	}

	/** The axioms shown: those the pane was given, or those it read again in another format. */
	readonly #axioms: LoadController<TViewAxioms> = new LoadController<TViewAxioms>(this, async (): Promise<TCallOutcome<TViewAxioms>> => {
		const shown: TViewAxioms | undefined = this.#axioms.page;
		if (shown === undefined) throw new Error("the axioms pane reads again the view it was given, and wasn't given one");
		const format = sourceFormat(this.state.format);
		const outcome = await callStep<unknown>(format.step, { view: shown.graphView }, `the graph as ${format.label}`);
		return outcome.ok ? { ok: true, value: ViewAxiomsProductsSchema.parse(outcome.value) } : outcome;
	});
	/** The reader's line. */
	#line: string | null = null;
	/** The lines that state the page's active record. */
	#lit: ReadonlySet<string> = new Set();
	/** Whether the reader's line or the lit lines moved since the last render, to bring them into view. */
	#moved = false;
	readonly #subject = new SubjectController(this, (record) => this.light(record === null ? [] : [record.id]));

	constructor() {
		super(GraphSourceStateSchema, { format: SOURCE_FORMATS[0].id });
	}

	/** The axioms a pane request carries, and the frame it opens at first. */
	set products(data: Record<string, unknown>) {
		this.show(GraphSourcePaneSchema.parse(data));
	}

	/** The axioms a step's products carry, as an embedded product view gives them. */
	openProducts(products: Record<string, unknown>): void {
		this.products = products;
	}

	private show({ line, ...axioms }: z.output<typeof GraphSourcePaneSchema>): void {
		this.#axioms.hold(axioms);
		this.#line = line === undefined ? null : line;
		const record = this.#subject.record;
		this.light(record === null ? [] : [record.id]);
	}

	/** Lights the lines that state `nodes`. */
	private light(nodes: string[]): void {
		const axioms = this.#axioms.page;
		this.#lit = new Set(axioms === undefined ? [] : linesOf(axioms, nodes));
		this.#moved = true;
		this.requestUpdate();
	}

	static styles = [
		shuBaseStyles,
		css`
			:host { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--shu-bg); }
			.head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--shu-space-3); padding: var(--shu-space-1) var(--shu-space-3); font-size: var(--shu-font-sm); color: var(--shu-fg-muted); }
			[role="status"] { flex: 1 1 auto; }
			p { margin: 0; padding: var(--shu-space-2) var(--shu-space-3); color: var(--shu-fg-muted); }
			ol { flex: 1 1 auto; overflow: auto; margin: 0; padding: var(--shu-space-1) 0; list-style: none; outline-offset: -2px; }
			li { white-space: pre-wrap; padding: 0 var(--shu-space-3); cursor: pointer; }
			li:hover { background: var(--shu-bg-hover); }
			li.lit { background: var(--shu-accent-soft); }
			li[aria-selected="true"] { background: var(--shu-accent); color: var(--shu-accent-fg); }
			li + li { margin-top: var(--shu-space-1); }
		`,
	];

	override render(): TemplateResult {
		return this.#axioms.render<TemplateResult>({
			pending: () => html`<p>the axioms of a graph view open here, from its ¶ control or from <code>show axioms of {view}</code></p>`,
			running: () => html`<p>reading the graph as ${sourceFormat(this.state.format).label}…</p>`,
			completed: (axioms) => this.renderAxioms(axioms),
			failed: (refusal) => html`<shu-refusal .refusal=${refusal} .readAgain=${() => void this.#axioms.run()}></shu-refusal>`,
		});
	}

	private renderAxioms(axioms: TViewAxioms): TemplateResult {
		const format = sourceFormat(this.state.format);
		const line = this.#line;
		const file = `graph.${format.extension}`;
		return html`<div class="head">
				<select aria-label="source format" .value=${format.id} @change=${(e: Event) => this.chooseFormat((e.target as HTMLSelectElement).value)}>
					${SOURCE_FORMATS.map(({ id, label }) => html`<option value=${id} ?selected=${id === format.id}>${label}</option>`)}
				</select>
				<span>${summaryOf(axioms.summary)}</span>
				<span role="status">${statusOf(
					axioms.frames.find(({ name }) => name === line),
					this.#lit,
				)}</span>
				<shu-copy-button label="⧉" title=${`copy the ${format.label} text to the clipboard`} .source=${axioms.text}></shu-copy-button>
				<button type="button" title=${`download the ${format.label} text as ${file}`} @click=${() => saveFile(axioms.text, file)}>⤓</button>
			</div>
			<ol
				role="listbox"
				tabindex="0"
				data-testid=${SHU_TEST_IDS.GRAPH_SOURCE.LINES}
				aria-label=${`the graph as ${format.label}`}
				aria-activedescendant=${line === null ? nothing : lineId(line)}
				@keydown=${this.onKey}
				@click=${this.onPress}
			>
				${axioms.frames.map(
					(frame) =>
						html`<li role="option" id=${lineId(frame.name)} data-name=${frame.name} aria-selected=${frame.name === line} class=${this.#lit.has(frame.name) ? "lit" : ""} title=${provenanceOf(frame)}>${frame.manchester} ${termRef(frame)}</li>`,
				)}
			</ol>`;
	}

	/** The reader chose the format the axioms read as: the pane reads its view again in it. */
	private chooseFormat(id: string): void {
		this.setState({ format: sourceFormat(id).id });
		void this.#axioms.refresh();
	}

	/** Moves the reader to a line, or lets the line go. */
	private chooseLine(line: string | null): void {
		this.#line = line;
		this.#moved = true;
		this.requestUpdate();
	}

	/** A press on a line moves the reader to it, and a press on the reader's own line lets it go. A press on a link in a line
	 *  follows the link. */
	private onPress = (e: Event): void => {
		const target = e.target as Element;
		if (target.closest("a") !== null) return;
		const name = target.closest("li")?.getAttribute("data-name");
		if (name) this.chooseLine(name === this.#line ? null : name);
	};

	/** The arrow keys, Home and End move the reader through the lines, and Escape lets the line go. */
	private onKey = (e: KeyboardEvent): void => {
		const axioms = this.#axioms.page;
		if (axioms === undefined) return;
		const next =
			e.key === "Escape"
				? null
				: lineAfterKey(
						axioms.frames.map(({ name }) => name),
						this.#line,
						e.key,
					);
		if (next === undefined) return;
		e.preventDefault();
		this.chooseLine(next);
	};

	/** The reader's line, or the first lit line, stays in view as it changes. */
	protected override updated(changed: PropertyValues<this>): void {
		super.updated(changed);
		if (!this.#moved) return;
		this.#moved = false;
		const shown = this.renderRoot.querySelector(this.#line === null ? "li.lit" : 'li[aria-selected="true"]');
		if (shown !== null) revealInDocument(shown, { block: "nearest", inline: "nearest", behavior: "auto" });
	}
}

defineElement(SHU_TAG.GRAPH_SOURCE, ShuGraphSource);
