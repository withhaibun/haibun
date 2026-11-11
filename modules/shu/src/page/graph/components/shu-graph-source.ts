/**
 * shu-graph-source: the axioms of what a graph view shows, or of the records a proof wrote, in a pane of its own: each frame in Manchester syntax, with its
 * axioms in DL notation, the statement and the record behind it on hover, the summary of the source's kinds, the format it
 * reads, and a copy and a download of its text. A line that states a record or a class links to its pane, the lines that
 * state the record a reader is on light, and the reader's line moves to the frame of each record a reader opens. A reader moves through the lines with the arrow keys, Home and End, and lets the
 * line go with Escape or a second press.
 *
 * The pane shows what `show axioms of {view}` returned, which a graph view's ¶ control and an edge chosen in its DL view open it
 * with, the latter at the frame that states it. It holds the view the axioms state, so it reads that view again
 * in another format. A derivation's products open it at the frame of the first goal the proof couldn't prove, and a proof
 * doesn't state a view to read again.
 */
import { css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { z } from "zod";
import { FRAME_KIND, GraphAxiomsSchema, type TFrame } from "@haibun/core/lib/records/domains/axioms.js";
import { RPC_METHOD, SHU_EVENT, SHU_TAG } from "../../../domains/elements.js";
import { SHU_TEST_IDS } from "../../../domains/test-ids.js";
import { GraphViewSchema, ViewAxiomsProductsSchema } from "../../../domains/graph-view.js";
import { defineElement } from "../../controllers/element-controller.js";
import { saveFile } from "../../controllers/file-controller.js";
import { LoadController } from "../../controllers/load-controller.js";
import { typeShownIn } from "../../controllers/catalog-controller.js";
import { callStep } from "../../controllers/read-controller.js";
import type { TCallOutcome } from "../../pipelines/call-step.js";
import { SubjectController } from "../../controllers/subject-controller.js";
import { ShuElement, type TLinkedData } from "../../components/shu-element.js";
import { shuBaseStyles } from "../../components/styles.js";
import { revealInDocument } from "../../components/reveal.js";
import { paneHref } from "../../components/ref-navigation.js";
import "../../components/shu-refusal.js";
import { SOURCE_FORMATS, SOURCE_FORMAT_IDS, sourceFormat, type TSourceFormat } from "../domains/sources.js";
import { frameOfNode, lineAfterKey, linesOf, provenanceOf, statusOf, summaryOf } from "../derivations/source-lines.js";

/** The axioms the pane shows, and the view they state where they state one. */
const PaneAxiomsSchema = z.object({ ...GraphAxiomsSchema.shape, graphView: GraphViewSchema.optional() });
type TPaneAxioms = z.output<typeof PaneAxiomsSchema>;
/** The axioms the pane is given, the view they state, and the frame it opens at first. A step's products carry hypermedia markers
 *  and the fields of their own domain beside them, which the pane doesn't read. */
const GivenAxiomsSchema = PaneAxiomsSchema.extend({ line: z.string().optional() });
/** What the pane is given: axioms, or the id of a step's record, whose derivation the pane reads. */
export const GraphSourcePaneSchema = z.union([GivenAxiomsSchema, z.object({ step: z.string() })]);
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

	/** The axioms shown: those the pane was given, the derivation of the step it was given, or those it read again in another format. */
	readonly #axioms: LoadController<TPaneAxioms> = new LoadController<TPaneAxioms>(this, async (): Promise<TCallOutcome<TPaneAxioms>> => {
		const step = this.#step;
		if (step !== undefined) {
			const derived = await callStep<unknown>(RPC_METHOD.RECORDED_DERIVATION, { step: { persistedAs: typeShownIn(SHU_TAG.STEP_DETAIL), id: step } }, `the derivation of ${step}`);
			if (!derived.ok) return derived;
			const proof = this.opened(GivenAxiomsSchema.parse(derived.value));
			this.dispatchEvent(new CustomEvent(SHU_EVENT.PROOF_READ, { detail: proof.frames, bubbles: true, composed: true }));
			return { ok: true, value: proof };
		}
		const view = this.#axioms.page?.graphView;
		if (view === undefined) throw new Error("the axioms pane reads again the view it was given, and wasn't given one");
		const format = sourceFormat(this.state.format);
		const outcome = await callStep<unknown>(format.step, { view }, `the graph as ${format.label}`);
		return outcome.ok ? { ok: true, value: ViewAxiomsProductsSchema.parse(outcome.value) } : outcome;
	});
	/** The step whose derivation the pane reads, where it was given one. */
	#step: string | undefined = undefined;
	/** The reader's line. */
	#line: string | null = null;
	/** The lines that state the page's active record. */
	#lit: ReadonlySet<string> = new Set();
	/** Whether the reader's line or the lit lines moved since the last render, to bring them into view. */
	#moved = false;
	readonly #subject = new SubjectController(this, (record) => this.follow(record === null ? undefined : record.id, this.#axioms.page));

	constructor() {
		super(GraphSourceStateSchema, { format: SOURCE_FORMATS[0].id });
	}

	override copyText(): string | null {
		return this.#axioms.page?.text ?? null;
	}

	protected override get copyable(): boolean {
		return this.#axioms.page !== undefined;
	}

	/** The axioms a pane request carries, and the frame it opens at first. */
	set products(data: Record<string, unknown>) {
		this.show(GraphSourcePaneSchema.parse(data));
	}

	/** The axioms a step's products carry, as an embedded product view gives them. */
	openProducts(products: Record<string, unknown>): void {
		this.products = products;
	}

	private show(given: z.output<typeof GraphSourcePaneSchema>): void {
		if ("step" in given) {
			this.#step = given.step;
			void this.#axioms.run();
			return;
		}
		this.#axioms.hold(this.opened(given));
	}

	/** Opens the pane at the line given axioms name, lights the lines of the reader's active record, and returns the axioms. */
	private opened({ line, ...axioms }: z.output<typeof GivenAxiomsSchema>): TPaneAxioms {
		this.#line = line === undefined ? null : line;
		const record = this.#subject.record;
		this.light(record === null ? [] : [record.id], axioms);
		return axioms;
	}

	/** Moves the reader to the line that states the page's active record, where `axioms` state it, and lights the lines that state it. */
	private follow(id: string | undefined, axioms: TPaneAxioms | undefined): void {
		const frame = id === undefined || axioms === undefined ? undefined : frameOfNode(axioms, id);
		if (frame !== undefined) this.#line = frame;
		this.light(id === undefined ? [] : [id], axioms);
	}

	/** Lights the lines of `axioms` that state `nodes`. */
	private light(nodes: string[], axioms: TPaneAxioms | undefined): void {
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
			pending: () => html`<p>the axioms of a graph view open here, from its ¶ control or from <code>show axioms of {view}</code>, and a step's proof from its why</p>`,
			running: () => html`<p>reading the graph as ${sourceFormat(this.state.format).label}…</p>`,
			completed: (axioms) => this.renderAxioms(axioms),
			failed: (refusal) => html`<shu-refusal .refusal=${refusal} .readAgain=${() => void this.#axioms.run()}></shu-refusal>`,
		});
	}

	private renderAxioms(axioms: TPaneAxioms): TemplateResult {
		const format = sourceFormat(this.state.format);
		const line = this.#line;
		const file = `graph.${format.extension}`;
		return html`<div class="head">
				${axioms.graphView === undefined ? nothing : this.renderFormats(format.id)}
				<span>${summaryOf(axioms.summary)}</span>
				<span role="status">${statusOf(
					axioms.frames.find(({ name }) => name === line),
					this.#lit,
				)}</span>
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

	/** The formats a view's axioms read as, which a reader chooses between. */
	private renderFormats(chosen: TSourceFormat["id"]): TemplateResult {
		return html`<select aria-label="source format" .value=${chosen} @change=${(e: Event) => this.chooseFormat((e.target as HTMLSelectElement).value)}>
			${SOURCE_FORMATS.map(({ id, label }) => html`<option value=${id} ?selected=${id === chosen}>${label}</option>`)}
		</select>`;
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
