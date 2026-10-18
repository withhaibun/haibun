/**
 * <shu-entity-column>: Displays a single individual with edges.
 * Fetches individual+edges via RPC on open. Renders once per navigation.
 * HATEOAS rel-based links, each addressing the pane it opens. Fully type-agnostic, driven by schema metadata.
 */
import { html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { jsonDisclosure, literalWithJson, recordJson } from "./json-disclosure.js";
import { jsonCarried, RecordsSchema, isRecord } from "@haibun/core/lib/domains/json-text.js";
import { shuBaseStyles, shuIconButtonStyles } from "./styles.js";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { SHU_EVENT, ANNOTATION_GLYPH, SHU_TAG, TIME_SYNC_CLASS } from "../../domains/elements.js";
import { defineElement } from "../controllers/element-controller.js";
import { copyText } from "../controllers/clipboard-controller.js";
import { isReplyEdge, type TAnnotationView, type TPart, type TQuoteAnchor } from "@haibun/core/lib/domains/resources.js";
import { EntityColumnSchema } from "../../domains/schemas.js";
import { anIndividual, type TContextPattern } from "@haibun/core/lib/conversation/domains/conversation.js";
import { EntityController } from "../controllers/entity-controller.js";
import { unread, type TEntityResult, type TEntityView, type TAnnotationDraft } from "../domains/entity.js";
import { LOAD_STATUS } from "../domains/load.js";
import type { TLinkedBody } from "@haibun/core/lib/records/domains/body.js";
import { assertFragmentReads, fragmentReads, isFragment, pageOfPassage, pdfPage, type TFragment } from "@haibun/core/lib/domains/media-fragments.js";
import "./shu-annotated-body.js";
import {
	edgeRecordType,
	rangeOf,
	getEdgeTargetLabels,
	getSummaryFields,
	getIdField,
	getQueryableFields,
	getRels,
	refContext,
	roleEdgeLabelSet,
	getDeclaredEdgeLabel,
	firstDeclaredType,
} from "../controllers/catalog-controller.js";
import { propertyVocabulary } from "../../derivations/ontology-projection.js";
import { linkHtml, paneHref, refHref } from "./ref-navigation.js";
import { REF_DENOTES } from "@haibun/core/lib/domains/typed-links.js";
import { pageAddress } from "../controllers/hash-controller.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { z } from "zod";
import { CallLinkSchema, counted, statedTotal, type TCallLink, type TCounted } from "@haibun/core/lib/domains/hypermedia.js";
import { SentFileSchema, fileDataBlob } from "@haibun/core/lib/domains/media-object.js";
import { MEDIA_TYPE, viewedInBrowser } from "@haibun/core/lib/domains/media-types.js";
import { reportFailure } from "../controllers/client-log-controller.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { ClockController } from "../controllers/clock-controller.js";
import { TimelineViewController } from "../controllers/timeline-view-controller.js";
import { appAccessLevel } from "../controllers/view-query-controller.js";
import { esc, escAttr, renderContentHtml, utf8ToBase64, renderRef, refsInContent } from "../derivations/markdown.js";
import { buildBodyIframeDoc } from "../derivations/body-frame.js";
import { idOf, instanceLabel, isVisibleKey, extractFieldEntries, extractBodyLiterals, governanceFields } from "../controllers/record-controller.js";
import { isReferenceEdge } from "../derivations/record-fields.js";
import { formIn, preferredReading, readingsOf, withBodiesRead, type TReading } from "@haibun/core/lib/records/derivations/bodies.js";
import type { TWritten } from "../pipelines/call-step.js";
import type { TPageRefusal } from "../domains/refusal.js";
import "./shu-refusal.js";
import "./shu-spinner.js";
import { ObserverController } from "../controllers/observer-controller.js";

/** The name of the delay after which the copy button reads Copy again. */
const COPY_RESULT = "copy-result";

/** The links a record carries, by rel. */
const OfferedLinksSchema = z.record(z.string(), CallLinkSchema);
/** A file saved rather than opened: its bytes, typed as bytes, under the name with which it was sent. */
function saveFile(blob: Blob, name: string): void {
	const anchor = document.createElement("a");
	anchor.href = URL.createObjectURL(new Blob([blob], { type: MEDIA_TYPE.bytes }));
	anchor.download = name;
	anchor.click();
	URL.revokeObjectURL(anchor.href);
}

type VertexData = Record<string, unknown>;
type EdgeData = { type: string; target: VertexData; direction?: "out" | "in" };

/** How many fields the field table shows open. A record with many fields dumps them all at once, so a table holding more
 *  starts closed behind a summary naming how many, and a reader opens it when a field is the question. */
const FIELDS_FOLD_AT = 6;

/** How many targets a reference group shows before the rest collapse behind a summary naming how many. */
const TARGETS_FOLD_AT = 4;

/** A reference group's rendered targets: the first `TARGETS_FOLD_AT`, and the rest behind a disclosure naming how many. */
export function foldedTargets(targets: readonly string[]): string {
	if (targets.length <= TARGETS_FOLD_AT) return targets.join(", ");
	const rest = targets.slice(TARGETS_FOLD_AT);
	return `${targets.slice(0, TARGETS_FOLD_AT).join(", ")}<details class="ref-more"><summary class="ref-more-count">${rest.length} more</summary>${rest.join(", ")}</details>`;
}

/** The body toolbar's copy control, the same markup on every render, so the body frame beside it isn't rebuilt. A click
 *  copies the body the column shows. */
const COPY = "\u{1f4cb}";
const COPIED = "\u2705";
const NOT_COPIED = "\u274c";
const COPY_RESULT_SHOWN_MS = 1500;
const COPY_BODY_BUTTON = `<button class="copy-btn" title="Copy to clipboard">${COPY}</button>`;

export class ShuEntityColumn extends ShuElement<typeof EntityColumnSchema> {
	/** The instant the column shows. A record after it dims. */
	// A move of the cursor renders the column again, since whether the record is after the cursor is part of its render.
	readonly #timeline = new TimelineViewController(this, { onMove: () => this.requestUpdate() });
	static styles = [
		shuBaseStyles,
		shuIconButtonStyles,
		css`
		:host { display: flex; flex-direction: column; height: 100%; overflow: auto; padding: var(--shu-space-3) var(--shu-space-4); font-family: inherit; color: var(--shu-fg); }
		.entity-content { display: flex; flex-direction: column; flex: 1; min-height: 0; }
		.entity-header { padding: var(--shu-space-2) 0; }
		/* A statement about where the view came from, not a control: it doesn't have a border, background or radius, which read as a button. */
		.entity-from-store { align-self: flex-start; margin-bottom: var(--shu-space-1); font-size: var(--shu-font-sm); color: var(--shu-fg-muted); }
		.body-reading { padding: var(--shu-space-3); color: var(--shu-fg-muted); font-style: italic; }
		.entity-type { font-weight: 600; color: var(--shu-accent); font-size: 0.85em; letter-spacing: 0.5px; margin-right: var(--shu-space-4); }
		.entity-id { color: var(--shu-fg-muted); word-break: break-all; }
		.entity-summary { display: flex; flex-wrap: wrap; gap: var(--shu-space-1) 10px; padding: var(--shu-space-1) 0 var(--shu-space-2); color: var(--shu-fg-muted); font-size: 0.9em; }
		.summary-field:first-child { font-weight: 500; }
		.references { padding: var(--shu-space-2) 0; margin: var(--shu-space-1) 0; }
		.ref-group { padding: 1px 0; display: flex; flex-wrap: wrap; gap: var(--shu-space-2); align-items: baseline; }
		.ref-type { color: var(--shu-fg-faded); font-size: 0.8em; min-width: 70px; }
		.roles-explanation { padding: var(--shu-space-2) 0; margin: var(--shu-space-1) 0; border-bottom: var(--shu-border-w) solid var(--shu-border); }
		.roles-explanation .section-label { display: block; color: var(--shu-fg-muted); font-size: var(--shu-font-sm); margin-bottom: var(--shu-space-1); }
		.role-row { display: flex; flex-wrap: wrap; gap: var(--shu-space-2); align-items: baseline; padding: 1px 0; }
		.role-phrase { color: var(--shu-fg-muted); min-width: 90px; }
		.ref-count { color: var(--shu-fg-faded); }
		.entity-detail { margin: var(--shu-space-1) 0; font-size: 0.9em; }
		/* The view-settings surface shows only when the pane's ⚙ controls toggle is on (sets data-show-controls), like the document column. */
		.entity-controls { padding: var(--shu-space-1) 0 var(--shu-space-2); border-bottom: var(--shu-border-w) solid var(--shu-border); margin-bottom: var(--shu-space-2); }
		:host(:not([data-show-controls])) .entity-controls { display: none; }
		.annotation-toggle { display: flex; gap: var(--shu-space-2); align-items: center; color: var(--shu-fg-muted); font-size: var(--shu-font-sm); cursor: pointer; }
		/* The annotate toggle is a pane-icon (min/max/pin/settings look; aria-pressed = the accent-fill highlight the pane
		 * toggles use). The pencil glyph reads greyscale until the record carries annotations, then colour, so annotation
		 * presence is visible independently of whether the gutter is currently open. */
		.annotate-enter .anno-glyph { display: inline-flex; color: var(--shu-fg-muted); opacity: 0.75; transition: color 0.15s, opacity 0.15s; }
		.annotate-enter.has-annotations .anno-glyph { color: var(--shu-accent); opacity: 1; }
		.content-toolbar { display: flex; gap: var(--shu-space-2); padding: var(--shu-space-1) 0; align-items: center; }
		.content-switcher { display: flex; gap: var(--shu-space-2); }
		.content-switch-btn { font-size: 0.75em; padding: 1px var(--shu-space-3); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); cursor: pointer; background: var(--shu-bg-elevated); color: var(--shu-fg-muted); }
		.content-switch-btn[aria-pressed="true"] { background: var(--shu-accent); border-color: var(--shu-accent); color: var(--shu-accent-fg); }
		.hidden { display: none; }
		.detail-table { width: 100%; border-collapse: collapse; }
		.detail-table td { padding: 1px var(--shu-space-2); vertical-align: top; overflow-wrap: anywhere; }
		.fields-table { margin: var(--shu-space-1) 0 var(--shu-space-2); }
		/* The field table collapsed behind a disclosure: the summary line names how many fields it holds, and the table
		   opens on demand. A reader reads the summary first and opens the table when a field is the question. */
		.fields-disclosure { margin: var(--shu-space-1) 0 var(--shu-space-2); }
		.fields-disclosure > summary { color: var(--shu-fg-muted); font-size: 0.85em; cursor: pointer; padding: 2px 0; list-style-position: inside; }
		.fields-disclosure[open] > summary { margin-bottom: var(--shu-space-1); }
		/* A reference group collapsed the same way: the first few targets stay visible, and the rest open on demand. */
		.ref-more > summary { color: var(--shu-fg-faded); font-size: 0.85em; cursor: pointer; }
		.field-json { margin: 0; padding: var(--shu-space-2); background: var(--shu-bg-soft); border-radius: var(--shu-radius); font-size: 0.8em; white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
		.literal-body { margin: var(--shu-space-2) 0 0; padding: var(--shu-space-2); background: var(--shu-bg-soft); border-radius: var(--shu-radius); white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
		.field-name { white-space: nowrap; color: var(--shu-fg-faded); width: 80px; font-size: 0.85em; }
		/* Provenance mark (from the served @context): a standard/consumer vocabulary shows its prefix; haibun's own reads faint. */
		.vocab { font-size: 0.7em; margin-left: 2px; padding: 0 2px; border-radius: 2px; vertical-align: super; }
		.vocab-standard { color: var(--shu-accent); background: var(--shu-accent-soft); }
		.vocab-haibun { color: var(--shu-fg-faded); }
		.body-container { display: flex; flex-direction: column; flex: 1; min-height: 200px; }
		.body-iframe { width: 100%; height: 100%; min-height: 200px; border: none; background: #fff; }
		.body-refs { padding: var(--shu-space-2) 0; font-size: var(--shu-font-sm); }
		/* Locally-rendered (black-on-white) bodies invert in dark themes so they read natively; a text/html body is
		   the original document with its own colours and never inverts (see renderContentIframe). */
		.body-iframe.invertible { filter: invert(var(--shu-invert, 0)) hue-rotate(calc(var(--shu-invert, 0) * 180deg)); }
		.loading, .empty { color: var(--shu-fg-faded); padding: var(--shu-space-4); }
		`,
	];
	/** The showAnnotations toggle is kept per column across reloads, like every persisted view option. */
	static persistFields = ["showAnnotations"] as const;

	private vertex: VertexData | null = null;
	private edges: EdgeData[] = [];
	private incomingCount: TCounted = counted(0);
	private predicateLinkCount = 0;
	private edgeTargetCount = 0;
	/** Whether the enclosing column pane is the active column. A column outside a pane, as a unit test's, stays active. */
	#paneActive = true;
	readonly #observers = new ObserverController(this);
	/** Annotations anchored in the open individual's body, projected from the entity view; empty until resolved. */
	private annotationsList: TAnnotationView[] = [];
	/** A passage to reveal once the body renders, set by a Text Fragment reference into this individual. */
	private revealTarget: TQuoteAnchor | null = null;
	/** A part of the individual's media a reference names, as a PDF's page, at which a file the individual offers opens. */
	private fragment: TFragment | null = null;
	/** Each body that has been read whole, by its id, projected from the entity view. A body the reader has not opened is
	 *  absent, so the body area reads as loading rather than empty. */
	private bodiesRead: Record<string, TLinkedBody> = {};
	/** The reading a reader switched to, by its key. A record that does not list it shows its preferred reading. */
	private chosenReading: string | null = null;
	/** Full augmented products from getIndividualWithEdges (individual + edges + incomingCount + `_type/_summary/_description/_links/_seqPath`). Retained for the `<script type="application/ld+json">` block in render so an agent reading the page sees the same hypermedia, and returned on demand by `summarizeForContext`. */
	private products: Record<string, unknown> | null = null;

	/** The open record's products, the linked data the page embeds, with the text of each body the reader opened set on
	 *  that body. Null while the products are read. */
	summarizeForContext(): TLinkedData | null {
		return this.products === null ? null : withBodiesRead(this.products, this.bodiesRead);
	}
	/** The one data path for this individual: its entity, the annotations anchored in it, and how it resolved (live /
	 *  cache / offline), kept fresh over SSE. The column never fetches / falls back / reloads annotations itself. */
	private readonly entity = new EntityController(this, (view) => this.applyView(view));

	constructor() {
		super(EntityColumnSchema, { individualId: "", persistedAs: "", loading: false, showAnnotations: true, annotateMode: false });
	}

	/** Whether the record's valid time is after the instant this column shows, so it renders dimmed (CA4D11). A record
	 *  that doesn't state a valid time isn't after it. */
	#isFuture(): boolean {
		if (this.vertex === null) return false;
		const at = this.extractTimestamp(this.vertex, this.state.persistedAs);
		return at !== null && this.#timeline.isFuture(at);
	}

	/** Render arbitrary products as an individual view without RPC fetch. Releases the entity handle: these products are
	 *  the view now, so a live change to the individual last opened here must not replace them. */
	openProducts(products: Record<string, unknown>): void {
		this.entity.release();
		const label = String(products._type || "Result");
		const { _type, _summary, _component, _links, _undo, _seqPath, ...data } = products;
		this.vertex = data;
		this.edges = [];
		this.incomingCount = counted(0);
		this.products = products;
		this.annotationsList = [];
		this.setState({ individualId: String(_summary || ""), persistedAs: label, loading: false, fromStore: undefined });
	}

	/** Write a note the reader authored in the body, and re-resolve so it reads back anchored. The body reports what was
	 *  selected and written; the individual (and the entity handle that reaches it) is the column's, so the write is too. */
	private readonly annotateDraft = (draft: TAnnotationDraft): Promise<TWritten> => this.entity.annotate(draft);

	/** Why the record wasn't read, where its read was refused. */
	#refusal: TPageRefusal | undefined = undefined;

	/** Project the entity handle's view onto the render fields: the entity (applied for the field table/roles/body), the
	 *  annotations anchored in it, the text of any body already read, and the read's status and provenance the render
	 *  branches read. */
	private applyView(view: TEntityView): void {
		if (view.entity) this.applyEntity(view.entity);
		this.annotationsList = view.annotations;
		this.#refusal = view.status === LOAD_STATUS.FAILED ? view.refusal : undefined;
		this.bodiesRead = view.bodies;
		this.setState({ loading: unread(view), fromStore: view.provenance === "cache" || view.provenance === "offline" ? view.provenance : undefined });
		// Read the body of the reading the reader is shown, only that one, only once (the handle no-ops for a body already read).
		const shown = this.shownReading();
		if (shown !== undefined && view.bodies[shown.body] === undefined) this.entity.requestBody(shown.body);
	}

	/** Apply one entity result (from the shared store or a fresh fetch) to the render fields. */
	private applyEntity(result: TEntityResult): void {
		this.vertex = result.vertex;
		this.edges = result.edges as EdgeData[];
		this.incomingCount = result.incomingCount;
		this.products = result;
	}

	/** Show the part of the open individual a reference names: a quoted passage is revealed in its body, and a fragment of
	 *  its media is where a file it offers opens. The re-request path of a reference to a part. */
	revealPart(part: TPart): void {
		if (isFragment(part)) {
			this.fragment = part;
			this.requestUpdate();
			return;
		}
		// The latest reference determines where a file the record offers opens: at the page of the passage it quotes.
		this.fragment = null;
		this.revealTarget = part;
		this.setState({ showAnnotations: true });
	}

	/** Open an individual by ID through the entity handle: it serves a cached copy at once, else fetches (then falls back
	 *  to the persisted browser store when offline), and resolves the annotations anchored in it: one path, one shared
	 *  copy and one live subscription per individual. `applyView` projects each resolved state onto the render fields. */
	async open(id: string, label: string = firstDeclaredType(), selector?: TPart): Promise<void> {
		this.fragment = null;
		if (selector) this.revealPart(selector);
		this.#refusal = undefined;
		this.setState({ individualId: id, persistedAs: label });
		const readLevel = appAccessLevel();
		await this.entity.open(label, id, readLevel);
		this.dispatchEvent(new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, { detail: { patterns: [anIndividual(label, id)], readLevel, label }, bubbles: true, composed: true }));
	}

	override paneSubject(): TContextPattern[] | null {
		return this.state.individualId ? [anIndividual(this.state.persistedAs, this.state.individualId)] : null;
	}

	/** The first edge target is the one the reader follows next, so it is testable only on the active column: with several columns
	 *  open, a stamp on every column's first target is ambiguous. The enclosing pane reflects its active state to the `active`
	 *  attribute; a change re-renders this column so the stamp follows the active column. */
	protected override onConnected(): void {
		const pane = this.closest(SHU_TAG.COLUMN_PANE) as HTMLElement | null;
		if (pane === null) return;
		this.#paneActive = pane.hasAttribute("active");
		this.#observers.attributes(pane, ["active"], false, () => {
			const active = pane.hasAttribute("active");
			if (active === this.#paneActive) return;
			this.#paneActive = active;
			this.requestUpdate();
		});
	}

	render(): TemplateResult {
		const { loading, persistedAs } = this.state;
		this.predicateLinkCount = 0;
		this.edgeTargetCount = 0;

		if (loading) {
			const { individualId: vid, persistedAs: lbl } = this.state;
			return html`<shu-spinner .status=${`Fetching ${lbl} ${vid.slice(0, 30)}...`} .visible=${true}></shu-spinner>`;
		}
		const refusal = this.#refusal;
		if (refusal !== undefined) return html`<shu-refusal .refusal=${refusal} .readAgain=${() => void this.open(this.state.individualId, this.state.persistedAs)}></shu-refusal>`;
		if (!this.vertex) {
			if (this.state.individualId === "") return html`<shu-spinner status="Waiting..." visible></shu-spinner>`;
			throw new Error(`<shu-entity-column> shows ${persistedAs}:${this.state.individualId} without its record, a refusal or a read under way`);
		}

		const fields = extractFieldEntries(this.vertex, persistedAs);
		// Renderable body sub-resources (email/file/comment content) make this a full view, never a stub: the
		// body is the substance even when there are few scalar fields, so it must always reach renderContentIframe.
		const contentIframe = this.renderContentIframe(persistedAs);
		// Literal body-presentation content (a SeqPath's stepText → content): the field table drops body-presentation
		// fields, and the iframe path only renders linked bodies, so these inline scalars need their own block or vanish.
		const bodyLiterals = this.renderBodyLiterals(persistedAs);
		const governance = this.renderGovernance(persistedAs);
		const isStub = Object.values(fields).filter((v) => (Array.isArray(v) ? v.length > 0 : v)).length <= 1 && contentIframe.length === 0 && bodyLiterals.length === 0;
		const typeLine = this.typeLine(persistedAs);

		let contentHtml: string;
		if (isStub) {
			const id = idOf(this.vertex);
			contentHtml = `<div class="entity-header" data-testid="entity-stub"><span class="entity-type">${esc(persistedAs)}</span><span class="entity-id">${esc(id)}</span></div>${typeLine}${this.renderRoles()}${this.renderReferences()}`;
		} else {
			const summaryFields = getSummaryFields(persistedAs);
			// Every non-summary, non-edge scalar field, shown in full between the type line and the body. Object
			// values render as formatted JSON. Body-presentation content (a SeqPath's stepText) renders below via bodyLiterals.
			const detailEntries = Object.entries(fields).filter(([k]) => !getEdgeTargetLabels(k, persistedAs) && !summaryFields.has(k));
			const detailRows = detailEntries
				.map(([k, v]) => {
					if (this.isTypeField(k)) return this.typeRow(k, v);
					const valueHtml = Array.isArray(v) ? v.map((item) => this.formatFieldValue(item, k)).join(", ") : this.formatFieldValue(v, k);
					return `<tr><td class="field-name">${this.predicateLink(k)}${this.vocabBadge(k)}</td><td data-testid="entity-field-${escAttr(k)}">${valueHtml}</td></tr>`;
				})
				.join("");
			const detailTable = detailRows ? `<table class="detail-table fields-table" data-testid="entity-fields">${detailRows}</table>` : "";
			const fieldsHtml = detailTable
				? detailEntries.length > FIELDS_FOLD_AT
					? `<details class="fields-disclosure" data-testid="entity-fields-disclosure"><summary class="fields-summary">${detailEntries.length} fields</summary>${detailTable}</details>`
					: detailTable
				: "";
			const summaryHtml =
				summaryFields.size > 0
					? `<div class="entity-summary" data-testid="entity-summary">${Array.from(summaryFields)
							.flatMap((k) => {
								const v = fields[k];
								if (!v || (Array.isArray(v) && v.length === 0)) return [];
								const valueHtml = Array.isArray(v) ? v.map((item) => this.fieldValueHtml(item, k)).join(", ") : this.fieldValueHtml(v, k);
								return [`<span class="summary-field" data-testid="entity-field-${escAttr(k)}">${this.predicateLink(k)}${this.vocabBadge(k)} ${valueHtml}</span>`];
							})
							.join(" ")}</div>`
					: "";
			// The body area (iframe or inline-annotated) is rendered as a lit sub-template after this string, so annotations
			// reach shu-annotated-body as a real property rather than an attribute, hence contentIframe is NOT embedded here.
			contentHtml = `${typeLine}${summaryHtml}${this.renderRoles()}${fieldsHtml}${this.renderItemsTable()}${this.renderReferences()}${governance}${bodyLiterals}`;
		}

		return html`${unsafeHTML(this.emitHypermediaScript(this.products))}${this.renderColumnSettings()}<div class="entity-content ${this.#isFuture() ? TIME_SYNC_CLASS.FUTURE : ""}">${this.renderFromStore()}${this.renderOffers()}${unsafeHTML(`${contentHtml}${recordJson(this.vertex, false)}`)}${this.renderBodyArea(contentIframe)}</div>`;
	}

	protected updated(): void {
		if (!this.state.loading && this.#refusal === undefined && this.vertex) this.bindEvents();
	}

	/** The calls the record offers, each a control that states what it does: a link that doesn't state it, as the record's
	 *  own read, isn't offered. The record's links are its own, apart from the links of the step that read it. */
	private renderOffers(): TemplateResult {
		const offered = Object.entries(OfferedLinksSchema.parse(this.vertex?._links ?? {})).filter(([, link]) => link.summary);
		return html`${offered.map(
			([rel, link]) =>
				html`<button type="button" class="entity-offer" data-testid=${this.#paneActive ? `${SHU_TEST_IDS.COLUMN_BROWSER.ENTITY_OFFER}-${rel}` : ""} @click=${() => this.followOffer(link)}>${link.summary}${this.fragment ? ` at ${this.fragment.value}` : ""}</button>`,
		)}`;
	}

	/** Follow a call the record offers. A call that returns a file of a type a browser shows as it is
	 *  (`viewedInBrowser`) opens it in a tab of its own: a PDF in its own viewer, at the fragment a reference named, as its
	 *  page. A file of any other type is saved under its name, since its sender chose its type, and a browser runs a page of
	 *  that type, as HTML or SVG, with this page's origin. A browser opens a tab only shortly after a click, so a file read
	 *  for longer is refused, stating so; the tab doesn't hold a reference to this page. */
	private readonly followOffer = async (link: TCallLink): Promise<void> => {
		try {
			const { name, file } = SentFileSchema.parse(await this.entity.follow(link));
			const blob = fileDataBlob(file);
			if (!viewedInBrowser(blob.type)) return saveFile(blob, name);
			const at = this.fragment ?? this.pageOfRevealedPassage(blob.type);
			if (at) assertFragmentReads(at, blob.type);
			const opened = window.open("", "_blank");
			if (!opened) throw new Error(`the browser didn't open a tab for ${name}: it opens one only shortly after a click, and reading the file took longer`);
			opened.opener = null;
			opened.location.href = `${URL.createObjectURL(blob)}${at ? `#${at.value}` : ""}`;
		} catch (err) {
			reportFailure(SHU_TAG.ENTITY_COLUMN, `following "${link.summary}"`, err);
		}
	};

	/** The page of a PDF the passage a reference quoted is on, as the record's text marks each page's beginning: where a file
	 *  the record offers opens, so the passage is in view. */
	private pageOfRevealedPassage(mediaType: string): TFragment | undefined {
		const body = this.annotatableBody();
		const page = this.revealTarget && body ? pageOfPassage(body.text, this.revealTarget) : undefined;
		const at = page === undefined ? undefined : pdfPage(page);
		return at && fragmentReads(at, mediaType) ? at : undefined;
	}

	/** Where the view came from when it was not fetched: a copy held this session, or the browser store when offline.
	 *  Absent for a live fetch, so its presence shows a reader why the view appeared without one. */
	private renderFromStore(): TemplateResult {
		const { fromStore } = this.state;
		if (!fromStore) return html``;
		const label = fromStore === "offline" ? "from the browser store (offline)" : "from a copy held this session";
		return html`<div class="entity-from-store" data-testid="entity-from-store">${label}</div>`;
	}

	/** The record's type as a link to the type's own view, which holds its description, schema and individuals: the same
	 *  navigation a @type value and a #Type reference use. Empty for an ad-hoc result view without a registered type. */
	private typeLine(persistedAs: string): string {
		if (getRels(persistedAs) === undefined) return "";
		const link = linkHtml(refHref(REF_DENOTES.type, { domain: persistedAs }), persistedAs, ` data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.ENTITY_TYPE_LINK}"`);
		return `<div class="entity-detail" data-testid="entity-details">${link}</div>`;
	}

	/** Render arrays of objects as tables (e.g. show domains items). Skips `hasBody` (rendered as iframes), JSON-LD keywords, and underscore-projected keys. */
	private renderItemsTable(): string {
		if (!this.vertex) return "";
		const { persistedAs } = this.state;
		const tables: string[] = [];
		for (const [k, v] of Object.entries(this.vertex)) {
			if (!isVisibleKey(k, persistedAs)) continue;
			if (!Array.isArray(v) || v.length === 0 || typeof v[0] !== "object") continue;
			const items = RecordsSchema.parse(v);
			// Inner table: items don't have a per-row label, fall back to projection-only filter.
			const keys = Object.keys(itemAt(items, 0)).filter((key) => isVisibleKey(key));
			// An item that names its type and identity is a record, and its row opens it.
			const records = items.some((item) => typeof item["@type"] === "string" && typeof item["@id"] === "string");
			const header = `${records ? "<th>@id</th>" : ""}${keys.map((key) => `<th>${esc(key)}</th>`).join("")}`;
			const rows = items
				.map(
					(item) =>
						`<tr>${records ? `<td>${linkHtml(typeof item["@type"] === "string" ? refHref(REF_DENOTES.individual, { persistedAs: item["@type"], id: idOf(item) }) : undefined, idOf(item))}</td>` : ""}${keys
							.map((key) => {
								const val = item[key];
								return `<td>${esc(typeof val === "object" && val !== null ? JSON.stringify(val) : String(val ?? ""))}</td>`;
							})
							.join("")}</tr>`,
				)
				.join("");
			tables.push(`<table class="detail-table items-table"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`);
		}
		return tables.join("");
	}

	/** Render an edge target as a link to it. */
	private renderEdgeTarget(target: VertexData, edgeType: string): string {
		const display = instanceLabel(target);
		const testId = this.#paneActive && this.edgeTargetCount === 0 ? ` data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.EDGE_TARGET_FIRST}"` : "";
		this.edgeTargetCount++;
		return linkHtml(this.edgeTargetHref(edgeType, target), display, testId);
	}

	/** The address of an edge's target, typed by the edge's range where it names one type and by the target otherwise. */
	private edgeTargetHref(edgeType: string, target: VertexData): string | undefined {
		const persistedAs = edgeRecordType(this.state.persistedAs, edgeType) ?? (target["@type"] as string) ?? firstDeclaredType();
		return refHref(REF_DENOTES.individual, { persistedAs, id: idOf(target) });
	}

	/** Plain-language names for the roles CORE's own general rels name. A consumer edge's phrase comes from its declared
	 *  edge label in the concern catalog (getDeclaredEdgeLabel): this view doesn't name a consumer vocabulary. */
	private static readonly ROLE_PHRASE: Record<string, string> = {
		delegator: "Delegated by",
		performedBy: "Performed by",
		controller: "Controlled by",
		wasAttributedTo: "Attributed to",
		attributedTo: "Attributed to",
		author: "Written by",
	};

	/** The node's roles in plain language, who plays what role toward it, so the roles are explained rather than left
	 *  as raw rels. Reads the role edges (the catalog controller's roleEdgeLabelSet). A role is one fact per (rel, party), so a rel
	 *  repeated to the same party renders once, as renderReferences dedups its targets. */
	private renderRoles(): string {
		const roles = roleEdgeLabelSet();
		const seen = new Set<string>();
		const rows = this.edges
			.filter((e) => roles.has(e.type) && isReferenceEdge(e.type))
			.filter((e) => {
				const key = `${e.type}${idOf(e.target)}`;
				return seen.has(key) ? false : (seen.add(key), true);
			})
			.map(
				(e) =>
					`<div class="role-row"><span class="role-phrase">${esc(ShuEntityColumn.ROLE_PHRASE[e.type] ?? getDeclaredEdgeLabel(e.type) ?? e.type)}</span> ${this.renderEdgeTarget(e.target, e.type)}</div>`,
			)
			.join("");
		if (!rows) return "";
		return `<div class="roles-explanation" data-testid="entity-roles"><span class="section-label">Roles</span>${rows}</div>`;
	}

	private renderReferences(): string {
		// Exclude edges already shown in the summary section
		const summaryFields = getSummaryFields(this.state.persistedAs);
		const roles = roleEdgeLabelSet();
		const outgoing = this.edges.filter((e) => !summaryFields.has(e.type) && isReferenceEdge(e.type) && !roles.has(e.type));

		if (outgoing.length === 0 && this.incomingCount.total === 0) return "";

		// Deduplicate targets for display, inReplyTo takes priority over references
		const seen = new Set<string>();
		const grouped = new Map<string, Array<{ target: VertexData; edgeType: string }>>();
		const sorted = [...outgoing].sort((a, b) => (isReplyEdge(b.type) ? 1 : 0) - (isReplyEdge(a.type) ? 1 : 0));
		for (const e of sorted) {
			const tid = idOf(e.target);
			if (seen.has(tid)) continue;
			seen.add(tid);
			const group = grouped.get(e.type) || [];
			group.push({ target: e.target, edgeType: e.type });
			grouped.set(e.type, group);
		}
		const outHtml = Array.from(grouped.entries())
			.map(
				([type, items]) => `<div class="ref-group"><span class="ref-type">${esc(type)}</span>${foldedTargets(items.map((i) => this.renderEdgeTarget(i.target, i.edgeType)))}</div>`,
			)
			.join("");

		const { persistedAs, individualId: subject } = this.state;
		const incoming = paneHref({ paneType: "filter-incoming", persistedAs, subject });
		const inHtml =
			this.incomingCount.total > 0
				? `<a class="section-label links-here-link" href="${escAttr(incoming)}">What links here <span class="ref-count">(${statedTotal(this.incomingCount)})</span></a>`
				: "";
		const hasReplies = this.edges.some((e) => isReplyEdge(e.type)) || this.incomingCount.total > 0;
		const replyHtml = hasReplies ? `<a class="section-label thread-link" href="${escAttr(paneHref({ paneType: "thread", persistedAs, subject }))}">View replies</a>` : "";

		return `<div class="references" data-testid="ref-section">${outHtml}${inHtml}${replyHtml}</div>`;
	}

	/**
	 * Renders the readings of the linked Body sub-resources (`vertex.hasBody`), each form of each Body, as one content iframe
	 * with a switcher where there are several. Each reading renders by its media type, for a Comment's markdown, an Email's
	 * markdown, plain text and HTML, a Proposal's rationale and a File's markdown alike.
	 */
	private renderContentIframe(_persistedAs: string): string {
		const vertex = this.vertex;
		if (!vertex) return "";
		// The record NAMES its bodies and the media type of each of their forms; their text is read on request, so the
		// switcher is drawn from the listing and the shown reading's text appears once its body has been read.
		const available = readingsOf(vertex);
		const active = this.shownReading();
		if (active === undefined) return "";

		const switcherHtml =
			available.length > 1
				? `<div class="content-switcher">${available
						.map(
							(b) =>
								`<button class="content-switch-btn" data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.BODY_READING}" aria-pressed="${b.key === active.key}" data-reading="${escAttr(b.key)}">${esc(b.media)}</button>`,
						)
						.join("")}</div>`
				: "";
		// Text this view was HANDED (a step's products carry their own body) doesn't need a request; otherwise it is the text
		// read on request, and until that lands the body area shows it is reading rather than showing an empty frame.
		const raw = this.textOf(active);
		if (raw === undefined)
			return `<div class="body-container"><div class="content-toolbar">${switcherHtml}</div><div class="body-reading" data-testid="body-reading">Reading ${esc(active.media)}…</div></div>`;
		if (raw === "") return ""; // an empty body renders an empty string, not an empty frame
		const content = renderContentHtml(raw, active.media, refContext);
		const encoded = utf8ToBase64(buildBodyIframeDoc(content, active.media, pageAddress()));
		const invertible = active.media !== MEDIA_TYPE.html ? " invertible" : "";
		const iframeHtml = `<iframe class="body-iframe${invertible}" data-reading="${escAttr(active.key)}" sandbox="allow-same-origin allow-top-navigation-by-user-activation" src="data:text/html;base64,${encoded}" data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.BODY_IFRAME}"></iframe>`;

		const annotateBtn = this.annotatableBody() ? this.annotateButtonHtml(false) : "";
		const toolbar = `<div class="content-toolbar">${switcherHtml}${COPY_BODY_BUTTON}${annotateBtn}</div>`;
		// References don't work inside the sandbox, so the ones the body makes are listed beside it.
		const refs = refsInContent(content, refContext);
		const refsHtml = refs.length
			? `<div class="body-refs" data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.BODY_REFS}">${refs.map((ref) => renderRef(ref.kind, ref.target, ref.text)).join(", ")}</div>`
			: "";
		return `<div class="body-container">${toolbar}${iframeHtml}${refsHtml}</div>`;
	}

	/** The reading the reader is shown, and the one whose body's text is to read: the one the reader switched to, where this
	 *  record lists it, and otherwise the preferred reading. Undefined where the record doesn't link a body. */
	private shownReading(): TReading | undefined {
		const available = this.vertex === null ? [] : readingsOf(this.vertex);
		const chosen = available.find((reading) => reading.key === this.chosenReading);
		return chosen === undefined ? preferredReading(available) : chosen;
	}

	/** The text of a reading: the text the record carries, or the text of its form of the body read on request. Undefined
	 *  until its body is read. */
	private textOf(reading: TReading): string | undefined {
		const read = this.bodiesRead[reading.body];
		return reading.text === undefined && read !== undefined ? formIn(read, [reading.media]) : reading.text;
	}

	/** The reading shown, where it is text (markdown or plain), with its text once read: what an annotation's quote is
	 *  anchored against, rendered inline so the annotator can highlight it. Null where the reading shown is not text,
	 *  such as an original HTML email, which stays in the sandboxed iframe, or where its text has not been read. */
	private annotatableBody(): { text: string; media: string } | null {
		const b = this.shownReading();
		if (b === undefined || (b.media !== MEDIA_TYPE.markdown && b.media !== MEDIA_TYPE.plain)) return null;
		const text = this.textOf(b);
		return text === undefined ? null : { text, media: b.media };
	}

	/** The annotation-gutter toggle for the body toolbar, identical markup in the iframe and inline paths so the two
	 *  never drift. `active` is whether the gutter is currently open (drives the pane-icon aria-pressed highlight); the
	 *  `has-annotations` class colours the pencil glyph, greyscale otherwise. */
	private annotateButtonHtml(active: boolean): string {
		const has = this.annotationsList.length > 0;
		const title = active ? "Hide annotations" : has ? "Show annotations" : "Add annotations";
		return `<button class="pane-icon annotate-enter${has ? " has-annotations" : ""}" data-testid="annotate-enter" type="button" aria-pressed="${active}" title="${title}"><span class="anno-glyph">${ANNOTATION_GLYPH}</span></button>`;
	}

	/** Show or hide the annotation gutter. On without annotations yet enters authoring (the inline view needs a note or
	 *  a draft to show); off also drops any pending passage reveal, since the reveal renders in the gutter. */
	private toggleAnnotationGutter(show: boolean): void {
		if (!show) this.revealTarget = null;
		this.setState({ showAnnotations: show, annotateMode: show && this.annotationsList.length === 0 });
	}

	/** The body area. A text body (markdown / plain) that carries annotations, with the gutter on (the default when any
	 *  exist), renders inline via shu-annotated-body: the passages highlighted and the notes shown in a margin rail
	 *  beside them, the toolbar's pencil toggling back to the plain iframe. Any other case (without annotations, gutter off, or a
	 *  non-text body such as an original HTML email) keeps the sandboxed body iframe, whose pencil turns the gutter on. */
	private renderBodyArea(iframeHtml: string): TemplateResult {
		if (!iframeHtml) return html``;
		const annBody = this.annotatableBody();
		const showInline = annBody && this.state.showAnnotations && (this.annotationsList.length > 0 || this.state.annotateMode || this.revealTarget !== null);
		if (showInline && annBody) {
			return html`<div class="content-toolbar">
					${unsafeHTML(COPY_BODY_BUTTON)}${unsafeHTML(this.annotateButtonHtml(true))}
				</div>
				<shu-annotated-body
					data-testid=${SHU_TEST_IDS.COLUMN_BROWSER.ANNOTATED_BODY}
					.content=${annBody.text}
					.mediaType=${annBody.media}
					.sourceId=${this.state.individualId}
					.sourceLabel=${this.state.persistedAs}
					.annotations=${this.annotationsList}
					.annotate=${this.annotateDraft}
					.show=${true}
					.revealTarget=${this.revealTarget}
				></shu-annotated-body>`;
		}
		return html`${unsafeHTML(iframeHtml)}`;
	}

	/** The column's view-settings surface, shown only under the pane's ⚙ (the pane sets `data-show-controls`), like the
	 *  document column's controls. Offers the Show-annotations option for any annotatable text body: on (the default) is
	 *  the inline annotated reading + authoring view; off returns to the plain body iframe. */
	private renderColumnSettings(): TemplateResult {
		if (this.annotatableBody() === null) return html``;
		const count = this.annotationsList.length;
		return html`<div class="entity-controls" data-testid="entity-controls">
			<label class="annotation-toggle"
				><input type="checkbox" data-testid="annotation-toggle" .checked=${this.state.showAnnotations} @change=${this.onToggleAnnotations} /> Show annotations${
					count > 0 ? html` (${count})` : html``
				}</label
			>
		</div>`;
	}

	private onToggleAnnotations(e: Event): void {
		this.setState({ showAnnotations: (e.target as HTMLInputElement).checked });
	}

	/** The record's governance fields: who may see it, what it allows, whether it is revoked. The field table drops them
	 *  (their rel indicates this section), so without this they don't render. */
	private renderGovernance(persistedAs: string): string {
		if (!this.vertex) return "";
		const fields = governanceFields(this.vertex, persistedAs);
		const rows = Object.entries(fields)
			.map(([k, v]) => `<div class="field-row"><span class="field-name">${esc(k)}</span><span class="field-value">${this.fieldValueHtml(v, k)}</span></div>`)
			.join("");
		return rows ? `<div class="governance" data-testid="entity-governance">${rows}</div>` : "";
	}

	/**
	 * Render literal body-presentation content: an inline scalar whose rel has presentation `body` (a SeqPath's
	 * `stepText`, mapped to `content`), as plain text blocks in the body area. isVisibleKey routes body-presentation
	 * fields out of the field table, but renderContentIframe only handles linked `hasBody` sub-resources, so a literal
	 * `content` value otherwise doesn't render.
	 */
	private renderBodyLiterals(persistedAs: string): string {
		if (!this.vertex) return "";
		return Object.entries(extractBodyLiterals(this.vertex, persistedAs))
			.map(([k, v]) => `<div class="literal-body" data-testid="entity-body-${escAttr(k)}">${literalWithJson(v)}</div>`)
			.join("");
	}

	/** A field's value formatted for the visible field table: an object or array is shown as disclosures a reader opens;
	 *  everything else falls through to fieldValueHtml (its navigation affordance + escaping). */
	private formatFieldValue(value: string, propertyName: string): string {
		const trimmed = value.trim();
		// A value that isn't JSON renders as an ordinary scalar.
		const carried = (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")) ? jsonCarried(trimmed) : undefined;
		if (carried !== undefined) return `<div class="field-json" data-testid="field-json-${escAttr(propertyName)}">${jsonDisclosure(carried)}</div>`;
		return this.fieldValueHtml(value, propertyName);
	}

	/** A field's value with the link it takes: the idField links to this individual (the idField is never a query
	 *  filter), an edge-valued or queryable field links through valueLink, and anything else is text. */
	private fieldValueHtml(value: string, propertyName: string): string {
		const label = this.state.persistedAs;
		if (propertyName === getIdField(label)) return linkHtml(refHref(REF_DENOTES.individual, { persistedAs: label, id: value }), value);
		if (rangeOf(label, propertyName) === "iri" || getQueryableFields(label).includes(propertyName)) return this.valueLink(value, propertyName);
		return esc(value);
	}

	/** The type's scoped @context (field → {@id, @type?}) from the served hypermedia: the server resolves each field to
	 *  its genuine vocabulary IRI here, so the view reads provenance/representation from it rather than guessing. Undefined
	 *  for an ad-hoc view without a served context. */
	private scopedContext(): Record<string, unknown> | undefined {
		// A JSON-LD @context is an object of terms, a URL, or a list of them; only an object holds a type's scoped context.
		const ctx = this.vertex?.["@context"];
		const scoped = isRecord(ctx) ? ctx[this.state.persistedAs] : undefined;
		const inner = isRecord(scoped) ? scoped["@context"] : undefined;
		// A type conforming to standard context(s) serves its scoped @context as a JSON-LD 1.1 array [url…, {haibun terms}];
		// the field definitions this view marks are in the object member (the last element). A plain object stands alone.
		if (Array.isArray(inner)) return inner.find(isRecord);
		return isRecord(inner) ? inner : undefined;
	}

	/** The IRI the served @context gives a field. */
	private fieldIri(propertyName: string): string | undefined {
		const term = this.scopedContext()?.[propertyName];
		const iri = isRecord(term) ? term["@id"] : undefined;
		return typeof iri === "string" ? iri : undefined;
	}

	/** A provenance mark on a field name, from the served @context's genuine IRI for the field: haibun's own reads faint,
	 *  a standard/consumer vocabulary shows its prefix (prov/schema/…). Empty when the context omits the field. */
	private vocabBadge(propertyName: string): string {
		const iri = this.fieldIri(propertyName);
		if (!iri) return "";
		const v = propertyVocabulary(iri);
		return `<sup class="vocab vocab-${v.source}" data-testid="vocab-${escAttr(propertyName)}" title="${escAttr(v.source === "haibun" ? "haibun vocabulary" : `${v.prefix} vocabulary`)}">${esc(v.prefix)}</sup>`;
	}

	/** True when the served @context aliases this field to the JSON-LD `@type` keyword, whose values are the entity's
	 *  classes rather than ordinary data. */
	private isTypeField(propertyName: string): boolean {
		return this.fieldIri(propertyName) === "@type";
	}

	/** Render the rdf:type field the standard JSON-LD way: named `@type`, its values the entity's classes: each a link
	 *  that opens the class's type column, so an entity carrying several classes has each one explorable. */
	private typeRow(propertyName: string, value: string | string[]): string {
		const classes = Array.isArray(value) ? value : [value];
		const links = classes
			.filter((c) => c)
			.map((c) => linkHtml(refHref(REF_DENOTES.type, { domain: c }), c, ` data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.TYPE_VALUE}"`))
			.join(", ");
		return `<tr><td class="field-name">@type</td><td data-testid="entity-field-${escAttr(propertyName)}">${links}</td></tr>`;
	}

	/** A field's value as a link: to the record an edge of that relation points at, or else to the records whose field
	 *  holds the same value. */
	private valueLink(value: string, propertyName: string): string {
		const target = rangeOf(this.state.persistedAs, propertyName) === "iri" ? this.edges.find((e) => e.type === propertyName && e.direction === "out")?.target : undefined;
		if (target) return linkHtml(this.edgeTargetHref(propertyName, target), value);
		return linkHtml(paneHref({ paneType: "filter-eq", persistedAs: this.state.persistedAs, predicate: propertyName, value }), value);
	}

	/** A field's name as a link to the records of this type, ordered by that field. */
	private predicateLink(propertyName: string): string {
		const testId = this.predicateLinkCount === 0 ? SHU_TEST_IDS.COLUMN_BROWSER.PREDICATE_LINK_FIRST : SHU_TEST_IDS.COLUMN_BROWSER.PREDICATE_LINK;
		this.predicateLinkCount++;
		return linkHtml(paneHref({ paneType: "filter-prop", persistedAs: this.state.persistedAs, predicate: propertyName }), propertyName, ` data-testid="${testId}"`, "pred-link");
	}

	// One delegated click listener on the shadow root, attached once. The content is `unsafeHTML` (a raw string lit does
	// NOT rebuild while unchanged), so a per-node addEventListener in `updated()` (which runs on every render) accumulated
	// a fresh listener on each surviving button: one click then fired N times. Delegation binds one stable listener to
	// the shadow root, which addEventListener dedups by identity, so re-binding every render is a no-op by spec. Links
	// don't need one: the page follows their addresses.
	private onShadowClick = (e: Event): void => {
		const target = e.target as Element | null;
		const switchBtn = target?.closest(".content-switch-btn") as HTMLElement | null;
		if (switchBtn) this.switchBody(switchBtn);
		const copyBtn = target?.closest(".copy-btn") as HTMLElement | null;
		if (copyBtn) void this.copyShownBody(copyBtn);
	};

	/** Copy the text of the body the column shows, and state on the button whether the copy succeeded. */
	private async copyShownBody(btn: HTMLElement): Promise<void> {
		const shown = this.shownReading();
		const text = shown === undefined ? undefined : this.textOf(shown);
		if (!text) return;
		const ok = await copyText(text);
		btn.classList.toggle("copied", ok);
		btn.textContent = ok ? COPIED : NOT_COPIED;
		this.#clock.trailing(COPY_RESULT, COPY_RESULT_SHOWN_MS, () => {
			btn.classList.remove("copied");
			btn.textContent = COPY;
		});
	}

	readonly #clock = new ClockController(this);

	/** Show the reading a reader switched to, and read its text where it has not been read. */
	private switchBody(btn: HTMLElement): void {
		const chosen = this.vertex === null ? undefined : readingsOf(this.vertex).find((reading) => reading.key === btn.dataset.reading);
		if (chosen === undefined) return;
		this.chosenReading = chosen.key;
		if (this.textOf(chosen) === undefined) this.entity.requestBody(chosen.body);
		this.requestUpdate();
	}

	private bindEvents(): void {
		this.shadowRoot?.addEventListener("click", this.onShadowClick);

		// Both toolbars render the toggle the same string way (annotateButtonHtml), so one binding covers both: a click
		// flips the gutter from whatever it is now. The `data-bound` guard stops a second listener attaching when a
		// re-render leaves the button node in place (unsafeHTML only recreates it when its string changes).
		const annotateBtn = this.shadowRoot?.querySelector<HTMLElement>(".annotate-enter");
		if (annotateBtn && !annotateBtn.dataset.bound) {
			annotateBtn.dataset.bound = "1";
			annotateBtn.addEventListener("click", () => this.toggleAnnotationGutter(!this.state.showAnnotations));
		}
	}
}

defineElement(SHU_TAG.ENTITY_COLUMN, ShuEntityColumn);
