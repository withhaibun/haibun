/**
 * <shu-entity-column>: Displays a single individual with edges.
 * Fetches individual+edges via RPC on open. Renders once per navigation.
 * HATEOAS rel-based links, each addressing the pane it opens. Fully type-agnostic, driven by schema metadata.
 */
import { html, css, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { disclosure, jsonTpl, literalWithJson, recordJson } from "./json-disclosure.js";
import { jsonCarried, RecordsSchema, isRecord } from "@haibun/core/lib/domains/json-text.js";
import { shuBaseStyles, shuIconButtonStyles } from "./styles.js";
import { SHOW_CONTROLS_FIELD, ShuElement, type TLinkedData } from "./shu-element.js";
import { SHU_EVENT, ANNOTATION_GLYPH, PRODUCTS_LABEL, SHU_TAG, TIME_SYNC_CLASS } from "../../domains/elements.js";
import { defineElement, loadedOnFirstUse } from "../controllers/element-controller.js";
import { MarkdownRendererController } from "../controllers/markdown-renderer-controller.js";
import { LinkRelations, isReplyEdge, type TAnnotationView, type TPart, type TQuoteAnchor } from "@haibun/core/lib/domains/resources.js";
import { EntityColumnSchema } from "../../domains/schemas.js";
import { anIndividual, type TContextPattern } from "@haibun/core/lib/conversation/domains/context-patterns.js";
import { EntityController } from "../controllers/entity-controller.js";
import { unread, type TEntityResult, type TEntityView, type TAnnotationDraft } from "../domains/entity.js";
import { LOAD_STATUS } from "../domains/load.js";
import type { TRecordFrame } from "@haibun/core/lib/records/domains/axioms.js";
import { fragmentReads, isFragment, pageOfPassage, pdfPage, type TFragment } from "@haibun/core/lib/domains/media-fragments.js";
import {
	edgeRecordType,
	rangeOf,
	getEdgeTargetLabels,
	getFieldRel,
	relationOfPredicate,
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
import { linkTpl, paneHref, passageHref, passageName, refHref } from "./ref-navigation.js";
import { titlePane } from "../derivations/pane-kinds.js";
import { REF_DENOTES } from "@haibun/core/lib/domains/typed-links.js";
import { pageAddress } from "../controllers/hash-controller.js";
import { SHU_TEST_IDS } from "../../domains/test-ids.js";
import { counted, statedTotal, type TCallLink, type TCounted } from "@haibun/core/lib/domains/hypermedia.js";
import { isJsonMedia, MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { HYPERMEDIA, productData, STATEMENT_STATUS } from "@haibun/core/lib/domains/protocol.js";
import { ClockController } from "../controllers/clock-controller.js";
import { TimelineViewController } from "../controllers/timeline-view-controller.js";
import { appAccessLevel } from "../controllers/view-query-controller.js";
import { recordClaimsRead, recordEvidenceRead } from "../controllers/read-controller.js";
import type { TEvidence, TRecordClaim } from "../domains/claims.js";
import { verdictStatusTpl } from "./verdict-status.js";
import { utf8ToBase64, refsInContent } from "../derivations/markdown.js";
import { refTpl } from "./shu-ref.js";
import { buildBodyIframeDoc } from "../derivations/body-frame.js";
import { idOf, instanceLabel, isVisibleKey, extractFieldEntries, extractBodyLiterals, governanceFields } from "../controllers/record-controller.js";
import { isReferenceEdge } from "../derivations/record-fields.js";
import { preferredReading, readingsOf, type TReading } from "@haibun/core/lib/records/derivations/bodies.js";
import type { TWritten } from "../pipelines/call-step.js";
import type { TPageRefusal } from "../domains/refusal.js";
import { refusalTpl } from "./load-renders.js";
import "./shu-refusal.js";
import "./shu-spinner.js";
import { ObserverController } from "../controllers/observer-controller.js";
import { recordSteps } from "../controllers/registry-controller.js";
import { normalizeStepKey } from "../derivations/steps.js";
import "./shu-record-steps.js";

type VertexData = Record<string, unknown>;
type EdgeData = { type: string; target: VertexData; direction?: "out" | "in" };

/** The inline annotated body and its annotator, loaded at the first body a reader reads with its annotations inline. The
 *  element upgrades once its module loads, with the properties the column set on it. A single-file bundle holds the
 *  module, and reads it without a fetch. */
const annotatedBody = loadedOnFirstUse(() => import("./shu-annotated-body.js").then(() => undefined));

/** The frame of a Class or Property record: its axioms in DL notation, one to a line, and then its Manchester syntax. A record of
 *  another type doesn't state a frame. */
const frameTpl = (frame: TRecordFrame | undefined): TemplateResult | typeof nothing =>
	frame === undefined ? nothing : html`<pre data-testid=${SHU_TEST_IDS.COLUMN_BROWSER.ENTITY_FRAME}>${[...frame.lines, "", frame.manchester].join("\n")}</pre>`;

/** What a view shows of a value: a template, or text. */
type TShown = TemplateResult | string;

/** What sets off each item of a list after the first. */
const LIST_SEPARATOR = ", ";

/** `items` in their order, each after the first set off by `separator`. */
const listed = (items: readonly TShown[], separator: string): TemplateResult[] => items.map((item, at) => html`${at === 0 ? nothing : separator}${item}`);

/** Returns the text a field's value copies as: a list's items joined, else the value as text. */
/** The `data-copy` key of the record's body. A field's key is its name. */
const BODY_COPY_KEY = "@body";
const copyTextOf = (v: unknown): string => (Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "" : String(v));

/** How many fields the field table shows open. A record with many fields dumps them all at once, so a table holding more
 *  starts closed behind a summary naming how many, and a reader opens it when a field is the question. */
const FIELDS_FOLD_AT = 6;

/** Where a reason's first statement ends, before the detail that supports it: a parenthesis, or a stop, colon or semicolon. */
const REASON_DETAIL = /\s\(|[.:;]\s/;

/** How many targets a reference group shows before the rest collapse behind a summary naming how many. */
const TARGETS_FOLD_AT = 4;

/** A reference group's rendered targets: the first `TARGETS_FOLD_AT`, and the rest behind a disclosure naming how many. */
export function foldedTargets(targets: readonly TShown[]): TemplateResult {
	if (targets.length <= TARGETS_FOLD_AT) return html`${listed(targets, LIST_SEPARATOR)}`;
	const rest = targets.slice(TARGETS_FOLD_AT);
	return html`${listed(targets.slice(0, TARGETS_FOLD_AT), LIST_SEPARATOR)}<details class="ref-more"><summary class="ref-more-count">${rest.length} more</summary>${listed(rest, LIST_SEPARATOR)}</details>`;
}

export class ShuEntityColumn extends ShuElement<typeof EntityColumnSchema> {
	static attributeFields = SHOW_CONTROLS_FIELD;
	/** The instant the column shows. A record after it dims. */
	// A move of the cursor renders the column again, since whether the record is after the cursor is part of its render.
	readonly #timeline = new TimelineViewController(this, { onMove: () => this.requestUpdate() });
	static styles = [
		shuBaseStyles,
		shuIconButtonStyles,
		// A statement about where the view came from, not a control: it doesn't have a border, background or radius, which read as
		// a button.
		// The view-settings surface shows only while the view's `showControls` holds, as the document column's does.
		// The annotate toggle is a pane-icon (min/max/pin/settings look; aria-pressed = the accent-fill highlight the pane toggles
		// use). The pencil glyph reads greyscale until the record carries annotations, then colour, so annotation presence is
		// visible independently of whether the gutter is currently open.
		// The field table collapsed behind a disclosure: the summary line names how many fields it holds, and the table opens on
		// demand. A reader reads the summary first and opens the table when a field is the question.
		// A reference group collapsed the same way: the first few targets stay visible, and the rest open on demand.
		// Provenance mark (from the served @context): a standard/consumer vocabulary shows its prefix; haibun's own reads faint.
		// Locally-rendered (black-on-white) bodies invert in dark themes so they read natively; a text/html body is the original
		// document with its own colours and never inverts (see renderContentIframe).
		css`
		:host { display: flex; flex-direction: column; height: 100%; overflow: auto; padding: var(--shu-space-3) var(--shu-space-4); font-family: inherit; color: var(--shu-fg); }
		.entity-content { display: flex; flex-direction: column; flex: 1; min-height: 0; }
		.entity-step .needs { opacity: 0.7; }
		.entity-header { padding: var(--shu-space-2) 0; }
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
		.entity-controls { padding: var(--shu-space-1) 0 var(--shu-space-2); border-bottom: var(--shu-border-w) solid var(--shu-border); margin-bottom: var(--shu-space-2); }
		:host(:not([data-show-controls])) .entity-controls { display: none; }
		.annotation-toggle { display: flex; gap: var(--shu-space-2); align-items: center; color: var(--shu-fg-muted); font-size: var(--shu-font-sm); cursor: pointer; }
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
		.fields-disclosure { margin: var(--shu-space-1) 0 var(--shu-space-2); }
		.fields-disclosure > summary { color: var(--shu-fg-muted); font-size: 0.85em; cursor: pointer; padding: 2px 0; list-style-position: inside; }
		.fields-disclosure[open] > summary { margin-bottom: var(--shu-space-1); }
		.ref-more > summary { color: var(--shu-fg-faded); font-size: 0.85em; cursor: pointer; }
		.field-json { margin: 0; padding: var(--shu-space-2); background: var(--shu-bg-soft); border-radius: var(--shu-radius); font-size: 0.8em; white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
		.literal-body { margin: var(--shu-space-2) 0 0; padding: var(--shu-space-2); background: var(--shu-bg-soft); border-radius: var(--shu-radius); white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
		.field-name { white-space: nowrap; color: var(--shu-fg-faded); width: 80px; font-size: 0.85em; }
		.vocab { font-size: 0.7em; margin-left: 2px; padding: 0 2px; border-radius: 2px; vertical-align: super; }
		.vocab-standard { color: var(--shu-accent); background: var(--shu-accent-soft); }
		.vocab-haibun { color: var(--shu-fg-faded); }
		.body-container { display: flex; flex-direction: column; flex: 1; min-height: 200px; }
		.body-iframe { width: 100%; height: 100%; min-height: 200px; border: none; background: #fff; }
		.body-refs { padding: var(--shu-space-2) 0; font-size: var(--shu-font-sm); }
		.body-iframe.invertible { filter: invert(var(--shu-invert, 0)) hue-rotate(calc(var(--shu-invert, 0) * 180deg)); }
		.loading, .empty { color: var(--shu-fg-faded); padding: var(--shu-space-4); }
		`,
	];
	/** The showAnnotations toggle is kept per column across reloads, like every persisted view option. */
	static persistFields = ["showAnnotations", "showControls"] as const;

	private vertex: VertexData | null = null;
	/** The body text the column shows, which a copy of the body takes. */
	#copiedBody = "";

	/** A copy of a field takes its value as text, and a copy of the body takes the body's text. */
	override copyOf(key: string): string {
		return key === BODY_COPY_KEY ? this.#copiedBody : copyTextOf(this.vertex?.[key]);
	}
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
	/** The reading a reader switched to, by its key. A record that does not list it shows its preferred reading. */
	private chosenReading: string | null = null;
	/** Full augmented products from getIndividualWithEdges (individual + edges + incomingCount + `_type/_summary/_description/_links/_seqPath`). Retained for the `<script type="application/ld+json">` block in render so an agent reading the page sees the same hypermedia, and returned on demand by `summarizeForContext`. */
	private products: Record<string, unknown> | null = null;

	/** The open record's products, the linked data the page embeds, with the text of each body its unit embeds. Null while
	 *  the products are read. */
	summarizeForContext(): TLinkedData | null {
		return this.#augmentedProducts();
	}

	#augmentedProducts(): Record<string, unknown> | null {
		if (this.products === null) return null;
		const { persistedAs, individualId } = this.state;
		if (!persistedAs || !individualId || persistedAs === PRODUCTS_LABEL) return this.products;
		const steps = recordSteps(persistedAs, individualId, this.vertex?._links as Record<string, TCallLink> | undefined);
		if (steps.length === 0) return this.products;
		const existingLinks = (this.products._links as Record<string, unknown>) ?? {};
		const mergedLinks: Record<string, unknown> = { ...existingLinks };
		for (const step of steps) {
			const key = step.rel ?? normalizeStepKey(step.method);
			if (mergedLinks[key] === undefined) {
				mergedLinks[key] = step;
			}
		}
		return { ...this.products, _links: mergedLinks };
	}
	/** The one data path for this individual: its entity, the annotations anchored in it, and how it resolved (live /
	 *  cache / offline), kept fresh over SSE. The column never fetches / falls back / reloads annotations itself. */
	private readonly entity = new EntityController(this, (view) => this.applyView(view));

	constructor() {
		super(EntityColumnSchema, { individualId: "", persistedAs: "", loading: false, showAnnotations: true, annotateMode: false, showControls: false });
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
		const label = String(products[HYPERMEDIA.TYPE] || PRODUCTS_LABEL);
		const { [HYPERMEDIA.UNDO]: _undo, ...data } = productData(products);
		this.vertex = data;
		this.edges = [];
		this.#frame = undefined;
		this.incomingCount = counted(0);
		this.products = products;
		this.annotationsList = [];
		this.setState({ individualId: String(products[HYPERMEDIA.SUMMARY] || ""), persistedAs: label, loading: false, fromStore: undefined });
		this.#statedError = this.statedError();
	}

	/** Write a note the reader authored in the body, and re-resolve so it reads back anchored. The body reports what was
	 *  selected and written; the individual (and the entity handle that reaches it) is the column's, so the write is too. */
	private readonly annotateDraft = (draft: TAnnotationDraft): Promise<TWritten> => this.entity.annotate(draft);

	/** The frame that states a Class or Property record, as the axioms pane shows it; undefined for a record of another type. */
	#frame: TRecordFrame | undefined;

	/** Why the record wasn't read, where its read was refused. */
	#refusal: TPageRefusal | undefined = undefined;

	/** Project the entity handle's view onto the render fields: the entity (applied for the field table/roles/body), the
	 *  annotations anchored in it, and the read's status and provenance the render branches read. */
	private applyView(view: TEntityView): void {
		if (view.entity) this.applyEntity(view.entity);
		this.annotationsList = view.annotations;
		this.#refusal = view.status === LOAD_STATUS.FAILED ? view.refusal : undefined;
		this.setState({ loading: unread(view), fromStore: view.provenance === "cache" || view.provenance === "offline" ? view.provenance : undefined });
	}

	/** The claims the reasoner made about the record the column shows, read once for each record, and why they weren't read
	 *  where their read was refused. */
	#claims: readonly TRecordClaim[] = [];
	#claimsRefusal: TPageRefusal | undefined = undefined;
	/** The passages the record cites as evidence of its values, read with its claims. */
	#evidence: readonly TEvidence[] = [];
	#claimsOf: string | undefined = undefined;

	/** Reads the claims about the record `label` `id` once, and holds them where the column still shows that record. */
	private async readClaims(label: string, id: string): Promise<void> {
		const curie = `${label}:${id}`;
		if (this.#claimsOf === curie) return;
		this.#claimsOf = curie;
		[this.#claims, this.#claimsRefusal, this.#evidence] = [[], undefined, []];
		const [read, cited] = await Promise.all([recordClaimsRead(label, id), recordEvidenceRead(label, this.edges)]);
		if (this.#claimsOf !== curie) return;
		if (read.ok) this.#claims = read.value;
		else this.#claimsRefusal = read.refusal;
		if (cited.ok) this.#evidence = cited.value;
		else this.#claimsRefusal = cited.refusal;
		this.requestUpdate();
	}

	/** Apply one entity result (from the shared store or a fresh fetch) to the render fields. */
	private applyEntity(result: TEntityResult): void {
		this.vertex = result.vertex;
		this.edges = result.edges as EdgeData[];
		this.#frame = result.frame;
		this.incomingCount = result.incomingCount;
		this.products = result;
		this.#statedError = this.statedError();
		// The pane is titled by the record's title once the record is read, rather than by its id.
		titlePane(this, () => this.recordTitle());
		const { persistedAs, individualId } = this.state;
		if (persistedAs !== "" && individualId !== "" && persistedAs !== PRODUCTS_LABEL) void this.readClaims(persistedAs, individualId);
	}

	/** The reason the open record states for its failure, as a refused verification does, shown first as the page shows a
	 *  refusal: its first statement, with the control that opens why the step that wrote the record was refused. The whole
	 *  reason reads in its field. Derived once as the record loads, so the refusal shown is one object across renders. */
	#statedError: TPageRefusal | undefined = undefined;

	/** The markdown renderer the column renders a body with; the body shows it is reading until it loads. */
	readonly #markdown = new MarkdownRendererController(this);

	private statedError(): TPageRefusal | undefined {
		const label = this.state.persistedAs;
		const fields = this.vertex === null ? {} : extractFieldEntries(this.vertex, label);
		const reason = Object.entries(fields).find(([k]) => getFieldRel(label, k) === LinkRelations.ERROR.rel)?.[1];
		if (typeof reason !== "string" || reason === "") return undefined;
		const generating = this.edges.find((e) => relationOfPredicate(e.type, label) === LinkRelations.WAS_GENERATED_BY.rel);
		return { error: itemAt(reason.split(REASON_DETAIL, 1), 0), step: generating === undefined ? undefined : idOf(generating.target) };
	}

	/** The open record's title, by the title of a record its edges point at where its type is titled by an edge. */
	private recordTitle(): string {
		if (this.vertex === null) throw new Error("<shu-entity-column> titles a record before it holds one");
		return instanceLabel(this.vertex, (edge) => {
			const target = this.edges.find((e) => e.type === edge)?.target;
			return target === undefined ? undefined : instanceLabel(target);
		});
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
		const { loading, persistedAs, individualId } = this.state;
		this.predicateLinkCount = 0;
		this.edgeTargetCount = 0;

		if (loading) {
			const { individualId: vid, persistedAs: lbl } = this.state;
			return html`<shu-spinner .status=${`Fetching ${lbl} ${vid.slice(0, 30)}...`} .visible=${true}></shu-spinner>`;
		}
		const refusal = this.#refusal;
		if (refusal !== undefined) return refusalTpl(refusal, { run: () => this.open(this.state.individualId, this.state.persistedAs) });
		if (!this.vertex) {
			if (this.state.individualId === "") return html`<shu-spinner status="Waiting..." visible></shu-spinner>`;
			throw new Error(`<shu-entity-column> shows ${persistedAs}:${this.state.individualId} without its record, a refusal or a read under way`);
		}

		const fields = extractFieldEntries(this.vertex, persistedAs);
		// Renderable body sub-resources (email/file/comment content) make this a full view, never a stub: the
		// body is the substance even when there are few scalar fields, so it must always reach renderContentIframe.
		const contentIframe = this.renderContentIframe();
		// Literal body-presentation content (a SeqPath's stepText → content): the field table drops body-presentation
		// fields, and the iframe path only renders linked bodies, so these inline scalars need their own block or vanish.
		const bodyLiterals = this.renderBodyLiterals(persistedAs);
		const governance = this.renderGovernance(persistedAs);
		const isStub = Object.values(fields).filter((v) => (Array.isArray(v) ? v.length > 0 : v)).length <= 1 && contentIframe === undefined && bodyLiterals.length === 0;
		// A Class or Property record states its frame below its type.
		const typeLine = html`${this.typeLine(persistedAs)}${frameTpl(this.#frame)}`;

		let content: TemplateResult;
		if (isStub) {
			content = html`<div class="entity-header" data-testid="entity-stub"><span class="entity-type">${persistedAs}</span><span class="entity-id">${idOf(this.vertex)}</span></div>${typeLine}${this.renderRoles()}${this.renderClaims()}${this.renderReferences()}`;
		} else {
			const summaryFields = getSummaryFields(persistedAs);
			// Every non-summary, non-edge scalar field, shown in full between the type line and the body. Object
			// values render as formatted JSON. Body-presentation content (a SeqPath's stepText) renders below via bodyLiterals.
			const detailEntries = Object.entries(fields).filter(([k]) => !getEdgeTargetLabels(k, persistedAs) && !summaryFields.has(k));
			const detailRows = detailEntries.map(([k, v]) => {
				if (this.isTypeField(k)) return this.typeRow(k, v);
				const value = listed(
					[v].flat().map((item) => this.formatFieldValue(item, k)),
					LIST_SEPARATOR,
				);
				return html`<tr><td class="field-name">${this.predicateLink(k)}${this.vocabBadge(k)}</td><td data-testid=${`${SHU_TEST_IDS.COLUMN_BROWSER.ENTITY_FIELD}-${k}`} data-copy=${k}>${value}${this.fieldEvidence(k, v)}${this.fieldStatus(k, v)}</td></tr>`;
			});
			const detailTable = html`<table class="detail-table fields-table" data-testid="entity-fields">${detailRows}</table>`;
			const fieldsTpl =
				detailRows.length === 0
					? nothing
					: detailEntries.length > FIELDS_FOLD_AT
						? html`<details class="fields-disclosure" data-testid="entity-fields-disclosure"><summary class="fields-summary">${detailEntries.length} fields</summary>${detailTable}</details>`
						: detailTable;
			const summarySpans = Array.from(summaryFields).flatMap((k) => {
				const v = fields[k];
				if (!v || (Array.isArray(v) && v.length === 0)) return [];
				const value = listed(
					[v].flat().map((item) => this.fieldValueTpl(item, k)),
					LIST_SEPARATOR,
				);
				return [
					html`<span class="summary-field" data-testid=${`${SHU_TEST_IDS.COLUMN_BROWSER.ENTITY_FIELD}-${k}`} data-copy=${k}>${this.predicateLink(k)}${this.vocabBadge(k)} ${value}${this.fieldEvidence(k, v)}${this.fieldStatus(k, v)}</span>`,
				];
			});
			const summaryTpl = summaryFields.size > 0 ? html`<div class="entity-summary" data-testid="entity-summary">${listed(summarySpans, " ")}</div>` : nothing;
			// The body area (iframe or inline-annotated) renders after the record's JSON, below the fields.
			content = html`${typeLine}${summaryTpl}${this.renderRoles()}${fieldsTpl}${this.renderClaims()}${this.renderItemsTable()}${this.renderReferences()}${governance}${bodyLiterals}`;
		}

		const recordStepsBar =
			persistedAs && individualId && persistedAs !== PRODUCTS_LABEL
				? html`<shu-record-steps ?active=${this.#paneActive} label=${persistedAs} record-id=${individualId} .links=${this.vertex?._links} .fragment=${this.fragment} .fileAt=${this.fileAt} @step-success=${this.#onStepSuccess}></shu-record-steps>`
				: nothing;

		return html`${unsafeHTML(this.emitHypermediaScript(this.#augmentedProducts() ?? this.products))}${this.renderColumnSettings()}<div class="entity-content ${this.#isFuture() ? TIME_SYNC_CLASS.FUTURE : ""}">${this.renderFromStore()}${recordStepsBar}${this.#statedError === undefined ? nothing : html`<shu-refusal .refusal=${this.#statedError}></shu-refusal>`}${content}${recordJson(this.vertex, false)}${this.renderBodyArea(contentIframe)}</div>`;
	}

	/** The part of a file of `mediaType` at which a link the record offers opens it: the part a reference named, or the page of
	 *  a PDF the revealed passage is on, as the record's text marks each page's beginning. */
	private readonly fileAt = (mediaType: string): TFragment | undefined => {
		if (this.fragment !== null) return this.fragment;
		const body = this.annotatableBody();
		const page = this.revealTarget && body ? pageOfPassage(body.text, this.revealTarget) : undefined;
		const at = page === undefined ? undefined : pdfPage(page);
		return at && fragmentReads(at, mediaType) ? at : undefined;
	};

	#onStepSuccess = async (): Promise<void> => {
		const { individualId, persistedAs } = this.state;
		if (individualId && persistedAs) {
			await this.open(individualId, persistedAs);
		}
	};

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
	private typeLine(persistedAs: string): TemplateResult | typeof nothing {
		if (getRels(persistedAs) === undefined) return nothing;
		const link = linkTpl(refHref({ kind: REF_DENOTES.type, target: { domain: persistedAs } }), persistedAs, { testId: SHU_TEST_IDS.COLUMN_BROWSER.ENTITY_TYPE_LINK });
		return html`<div class="entity-detail" data-testid="entity-details">${link}</div>`;
	}

	/** Render arrays of objects as tables (e.g. a list's items). Skips `hasBody` (rendered as iframes), JSON-LD keywords, and underscore-projected keys. */
	private renderItemsTable(): TemplateResult[] {
		if (!this.vertex) return [];
		const { persistedAs } = this.state;
		return Object.entries(this.vertex).flatMap(([k, v]) => {
			if (!isVisibleKey(k, persistedAs) || !Array.isArray(v) || v.length === 0 || typeof v[0] !== "object") return [];
			const items = RecordsSchema.parse(v);
			// Inner table: items don't have a per-row label, fall back to projection-only filter.
			const keys = Object.keys(itemAt(items, 0)).filter((key) => isVisibleKey(key));
			// An item that names its type and identity is a record, and its row opens it.
			const records = items.some((item) => typeof item["@type"] === "string" && typeof item["@id"] === "string");
			const cell = (val: unknown): string => (typeof val === "object" && val !== null ? JSON.stringify(val) : String(val ?? ""));
			const recordCell = (item: Record<string, unknown>): TShown =>
				linkTpl(typeof item["@type"] === "string" ? refHref({ kind: REF_DENOTES.individual, target: { persistedAs: item["@type"], id: idOf(item) } }) : undefined, idOf(item));
			const rows = items.map((item) => html`<tr>${records ? html`<td>${recordCell(item)}</td>` : nothing}${keys.map((key) => html`<td>${cell(item[key])}</td>`)}</tr>`);
			return [
				html`<table class="detail-table items-table"><thead><tr>${records ? html`<th>@id</th>` : nothing}${keys.map((key) => html`<th>${key}</th>`)}</tr></thead><tbody>${rows}</tbody></table>`,
			];
		});
	}

	/** Render an edge target as a link to it. */
	private renderEdgeTarget(target: VertexData, edgeType: string): TShown {
		const testId = this.#paneActive && this.edgeTargetCount === 0 ? SHU_TEST_IDS.COLUMN_BROWSER.EDGE_TARGET_FIRST : undefined;
		this.edgeTargetCount++;
		return linkTpl(this.edgeTargetHref(edgeType, target), instanceLabel(target), { testId });
	}

	/** The address of an edge's target, typed by the edge's range where it names one type and by the target otherwise. */
	private edgeTargetHref(edgeType: string, target: VertexData): string | undefined {
		const persistedAs = edgeRecordType(this.state.persistedAs, edgeType) ?? (target["@type"] as string) ?? firstDeclaredType();
		return refHref({ kind: REF_DENOTES.individual, target: { persistedAs, id: idOf(target) } });
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
	private renderRoles(): TemplateResult | typeof nothing {
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
					html`<div class="role-row"><span class="role-phrase">${ShuEntityColumn.ROLE_PHRASE[e.type] ?? getDeclaredEdgeLabel(e.type) ?? e.type}</span> ${this.renderEdgeTarget(e.target, e.type)}</div>`,
			);
		if (rows.length === 0) return nothing;
		return html`<div class="roles-explanation" data-testid="entity-roles"><span class="section-label">Roles</span>${rows}</div>`;
	}

	private renderReferences(): TemplateResult | typeof nothing {
		// Exclude edges already shown in the summary section
		const summaryFields = getSummaryFields(this.state.persistedAs);
		const roles = roleEdgeLabelSet();
		const outgoing = this.edges.filter((e) => !summaryFields.has(e.type) && isReferenceEdge(e.type) && !roles.has(e.type));

		if (outgoing.length === 0 && this.incomingCount.total === 0) return nothing;

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
		const groups = Array.from(grouped.entries()).map(
			([type, items]) => html`<div class="ref-group"><span class="ref-type">${type}</span>${foldedTargets(items.map((i) => this.renderEdgeTarget(i.target, i.edgeType)))}</div>`,
		);

		const { persistedAs, individualId: subject } = this.state;
		const incoming = paneHref({ paneType: "filter-incoming", persistedAs, subject });
		const linksHere =
			this.incomingCount.total > 0
				? html`<a class="section-label links-here-link" href=${incoming}>What links here <span class="ref-count">(${statedTotal(this.incomingCount)})</span></a>`
				: nothing;
		const hasReplies = this.edges.some((e) => isReplyEdge(e.type)) || this.incomingCount.total > 0;
		const replies = hasReplies ? html`<a class="section-label thread-link" href=${paneHref({ paneType: "thread", persistedAs, subject })}>View replies</a>` : nothing;

		return html`<div class="references" data-testid="ref-section">${groups}${linksHere}${replies}</div>`;
	}

	/**
	 * Renders the readings of the linked Body sub-resources (`vertex.hasBody`), each form of each Body, as one content iframe
	 * with a switcher where there are several. Each reading renders by its media type, for a Comment's markdown, an Email's
	 * markdown, plain text and HTML, a Proposal's rationale and a File's markdown alike.
	 */
	private renderContentIframe(): TemplateResult | undefined {
		const vertex = this.vertex;
		if (!vertex) return undefined;
		// The record NAMES its bodies and the media type of each of their forms; their text is read on request, so the
		// switcher is drawn from the listing and the shown reading's text appears once its body has been read.
		const available = readingsOf(vertex);
		const active = this.shownReading();
		if (active === undefined) return undefined;

		const switcher =
			available.length > 1
				? html`<div class="content-switcher">${available.map(
						(b) =>
							html`<button class="content-switch-btn" data-testid=${SHU_TEST_IDS.COLUMN_BROWSER.BODY_READING} aria-pressed=${String(b.key === active.key)} data-reading=${b.key} @click=${() => this.switchBody(b.key)}>${b.media}</button>`,
					)}</div>`
				: nothing;
		// Text this view was HANDED (a step's products carry their own body) doesn't need a request; otherwise it is the text
		// read on request, and until that lands the body area shows it is reading rather than showing an empty frame.
		const raw = active.text;
		const reading = html`<div class="body-container"><div class="content-toolbar">${switcher}</div><div class="body-reading" data-testid="body-reading">Reading ${active.media}…</div></div>`;
		if (raw === undefined) return reading;
		if (raw === "") return undefined; // an empty body leaves the body area out, rather than showing an empty frame
		const renderer = this.#markdown.renderer;
		if (renderer === undefined) return reading;
		const content = renderer.renderContentHtml(raw, active.media, refContext);
		const encoded = utf8ToBase64(buildBodyIframeDoc(content, active.media, pageAddress()));
		const iframe = html`<iframe class=${active.media === MEDIA_TYPE.html ? "body-iframe" : "body-iframe invertible"} data-reading=${active.key} sandbox="allow-same-origin allow-top-navigation-by-user-activation" src=${`data:text/html;base64,${encoded}`} data-testid=${SHU_TEST_IDS.COLUMN_BROWSER.BODY_IFRAME}></iframe>`;

		const toolbar = html`<div class="content-toolbar">${switcher}${this.annotatableBody() ? this.annotateButton(false) : nothing}</div>`;
		// References don't work inside the sandbox, so the ones the body makes are listed beside it.
		const refs = refsInContent(content, refContext);
		const refsTpl = refs.length
			? html`<div class="body-refs" data-testid=${SHU_TEST_IDS.COLUMN_BROWSER.BODY_REFS}>${listed(
					refs.map(({ ref, text }) => refTpl(ref, text)),
					LIST_SEPARATOR,
				)}</div>`
			: nothing;
		this.#copiedBody = raw;
		const body = html`<div class="body-container" data-copy=${BODY_COPY_KEY}>${toolbar}${iframe}${refsTpl}</div>`;
		// A JSON body is a document's data, as a signed capability is, so it starts closed as the record's Data does.
		return isJsonMedia(active.media) ? disclosure(SHU_TEST_IDS.COLUMN_BROWSER.BODY_DOCUMENT, "Document", body, false) : body;
	}

	/** The reading the reader is shown, and the one whose body's text is to read: the one the reader switched to, where this
	 *  record lists it, and otherwise the preferred reading. Undefined where the record doesn't link a body. */
	private shownReading(): TReading | undefined {
		const available = this.vertex === null ? [] : readingsOf(this.vertex);
		const chosen = available.find((reading) => reading.key === this.chosenReading);
		return chosen === undefined ? preferredReading(available) : chosen;
	}

	/** The reading shown, where it is text (markdown or plain), with its text once read: what an annotation's quote is
	 *  anchored against, rendered inline so the annotator can highlight it. Null where the reading shown is not text,
	 *  such as an original HTML email, which stays in the sandboxed iframe, or where its text has not been read. */
	private annotatableBody(): { text: string; media: string } | null {
		const b = this.shownReading();
		if (b === undefined || (b.media !== MEDIA_TYPE.markdown && b.media !== MEDIA_TYPE.plain)) return null;
		const text = b.text;
		return text === undefined ? null : { text, media: b.media };
	}

	/** The annotation-gutter toggle for the body toolbar, identical markup in the iframe and inline paths so the two
	 *  never drift. `active` is whether the gutter is currently open (drives the pane-icon aria-pressed highlight); the
	 *  `has-annotations` class colours the pencil glyph, greyscale otherwise. */
	private annotateButton(active: boolean): TemplateResult {
		const has = this.annotationsList.length > 0;
		const title = active ? "Hide annotations" : has ? "Show annotations" : "Add annotations";
		return html`<button class=${has ? "pane-icon annotate-enter has-annotations" : "pane-icon annotate-enter"} data-testid="annotate-enter" type="button" aria-pressed=${String(active)} title=${title} @click=${() => this.toggleAnnotationGutter(!this.state.showAnnotations)}><span class="anno-glyph">${ANNOTATION_GLYPH}</span></button>`;
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
	private renderBodyArea(contentIframe: TemplateResult | undefined): TemplateResult | typeof nothing {
		if (contentIframe === undefined) return nothing;
		const annBody = this.annotatableBody();
		const showInline = annBody && this.state.showAnnotations && (this.annotationsList.length > 0 || this.state.annotateMode || this.revealTarget !== null);
		if (showInline && annBody) {
			void annotatedBody();
			return html`<div class="content-toolbar">${this.annotateButton(true)}</div>
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
		return contentIframe;
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
	private renderGovernance(persistedAs: string): TemplateResult | typeof nothing {
		if (!this.vertex) return nothing;
		const rows = Object.entries(governanceFields(this.vertex, persistedAs)).map(
			([k, v]) => html`<div class="field-row"><span class="field-name">${k}</span><span class="field-value">${this.fieldValueTpl(v, k)}</span></div>`,
		);
		return rows.length === 0 ? nothing : html`<div class="governance" data-testid="entity-governance">${rows}</div>`;
	}

	/**
	 * Render literal body-presentation content: an inline scalar whose rel has presentation `body` (a SeqPath's
	 * `stepText`, mapped to `content`), as plain text blocks in the body area. isVisibleKey routes body-presentation
	 * fields out of the field table, but renderContentIframe only handles linked `hasBody` sub-resources, so a literal
	 * `content` value otherwise doesn't render.
	 */
	private renderBodyLiterals(persistedAs: string): TemplateResult[] {
		if (!this.vertex) return [];
		return Object.entries(extractBodyLiterals(this.vertex, persistedAs)).map(
			([k, v]) => html`<div class="literal-body" data-testid=${`entity-body-${k}`}>${literalWithJson(v)}</div>`,
		);
	}

	/** A field's value formatted for the visible field table: an object or array is shown as disclosures a reader opens;
	 *  everything else falls through to fieldValueTpl, with its link. */
	private formatFieldValue(value: string, propertyName: string): TShown {
		const trimmed = value.trim();
		// A value that isn't JSON renders as an ordinary scalar.
		const carried = (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")) ? jsonCarried(trimmed) : undefined;
		if (carried !== undefined) return html`<div class="field-json" data-testid=${`field-json-${propertyName}`}>${jsonTpl(carried)}</div>`;
		return this.fieldValueTpl(value, propertyName);
	}

	/** A field's value with the link it takes: the idField links to this individual (the idField is never a query
	 *  filter), an edge-valued or queryable field links through valueLink, and anything else is text. */
	private fieldValueTpl(value: string, propertyName: string): TShown {
		const label = this.state.persistedAs;
		if (propertyName === getIdField(label)) return linkTpl(refHref({ kind: REF_DENOTES.individual, target: { persistedAs: label, id: value } }), value);
		if (rangeOf(label, propertyName) === "iri" || getQueryableFields(label).includes(propertyName)) return this.valueLink(value, propertyName);
		return value;
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
	private vocabBadge(propertyName: string): TemplateResult | typeof nothing {
		const iri = this.fieldIri(propertyName);
		if (!iri) return nothing;
		const v = propertyVocabulary(iri);
		return html`<sup class="vocab vocab-${v.source}" data-testid=${`vocab-${propertyName}`} title=${v.source === "haibun" ? "haibun vocabulary" : `${v.prefix} vocabulary`}>${v.prefix}</sup>`;
	}

	/** The status of a field beside its value: the verdict of the claim the reasoner made of it, described by the claim's sentence,
	 *  or assumed where a passage of outside input quotes its value and a claim hasn't determined it. Empty otherwise. */
	private fieldStatus(field: string, value: string | string[]): TemplateResult | typeof nothing {
		const testId = `${SHU_TEST_IDS.CLAIMS.FIELD_STATUS}-${field}`;
		const claim = this.#claims.find((held) => held.field === field);
		if (claim !== undefined) return html` ${verdictStatusTpl(testId, claim.test, claim.verdict)}`;
		const values = new Set([value].flat());
		return this.#evidence.some(({ quote }) => values.has(quote.exact))
			? html` ${verdictStatusTpl(testId, `the ${field} rests on the passage that quotes it`, STATEMENT_STATUS.assumed)}`
			: nothing;
	}

	/** The link from a field to each passage that quotes its value in the record's source, which opens the source with the passage
	 *  selected, named by where the passage is and the step that extracted it. Empty where a passage doesn't quote the value. */
	private fieldEvidence(field: string, value: string | string[]): TemplateResult[] {
		const values = new Set([value].flat());
		return this.#evidence.flatMap((evidence) => {
			const href = passageHref(evidence);
			if (href === undefined || !values.has(evidence.quote.exact)) return [];
			const label = passageName(`the ${field}`, evidence);
			return [html` ${linkTpl(href, "quote", { testId: `${SHU_TEST_IDS.CLAIMS.EVIDENCE}-${field}`, label, linkClass: "col-link evidence" })}`];
		});
	}

	/** The claims the reasoner made about the record, each with its status, its sentence and its proof, under a link to the step that
	 *  made it, so the claims of each step that wrote the record read apart: a claim of a field the record doesn't hold, such as an
	 *  Email's missing subject, reads here as unknown, since the open world doesn't read it as false. */
	private renderClaims(): TemplateResult | typeof nothing {
		if (this.#claimsRefusal !== undefined)
			return html`<section class="claims" data-testid=${SHU_TEST_IDS.CLAIMS.LIST}><h3>Claims</h3><p>the claims about the record weren't read: ${this.#claimsRefusal.error}</p></section>`;
		if (this.#claims.length === 0) return nothing;
		const claimTpl = ({ test, verdict, proof }: TRecordClaim): TemplateResult =>
			html`<li data-testid=${SHU_TEST_IDS.CLAIMS.CLAIM}>${verdictStatusTpl(SHU_TEST_IDS.CLAIMS.STATUS, test, verdict)} ${test}<details><summary>proof</summary>${proof}</details></li>`;
		const stepOf = ({ madeBy }: TRecordClaim): string => `${madeBy.label}:${madeBy.id}`;
		const steps = new Map(this.#claims.map((claim) => [stepOf(claim), claim.madeBy]));
		const bySteps = [...steps].map(([key, madeBy]) => {
			const step = linkTpl(refHref({ kind: REF_DENOTES.individual, target: { persistedAs: madeBy.label, id: madeBy.id } }), madeBy.title, { testId: SHU_TEST_IDS.CLAIMS.MADE_BY });
			return html`<li>by ${step}<ul>${this.#claims.filter((claim) => stepOf(claim) === key).map(claimTpl)}</ul></li>`;
		});
		return html`<section class="claims" data-testid=${SHU_TEST_IDS.CLAIMS.LIST}><h3>Claims</h3><ul>${bySteps}</ul></section>`;
	}

	/** True when the served @context aliases this field to the JSON-LD `@type` keyword, whose values are the entity's
	 *  classes rather than ordinary data. */
	private isTypeField(propertyName: string): boolean {
		return this.fieldIri(propertyName) === "@type";
	}

	/** Render the rdf:type field the standard JSON-LD way: named `@type`, its values the entity's classes: each a link
	 *  that opens the class's type column, so an entity carrying several classes has each one explorable. */
	private typeRow(propertyName: string, value: string | string[]): TemplateResult {
		const links = [value]
			.flat()
			.filter((c) => c)
			.map((c) => linkTpl(refHref({ kind: REF_DENOTES.type, target: { domain: c } }), c, { testId: SHU_TEST_IDS.COLUMN_BROWSER.TYPE_VALUE }));
		return html`<tr><td class="field-name">@type</td><td data-testid=${`${SHU_TEST_IDS.COLUMN_BROWSER.ENTITY_FIELD}-${propertyName}`}>${listed(links, LIST_SEPARATOR)}</td></tr>`;
	}

	/** A field's value as a link: to the record an edge of that relation points at, or else to the records whose field
	 *  holds the same value. */
	private valueLink(value: string, propertyName: string): TShown {
		const target = rangeOf(this.state.persistedAs, propertyName) === "iri" ? this.edges.find((e) => e.type === propertyName && e.direction === "out")?.target : undefined;
		if (target) return linkTpl(this.edgeTargetHref(propertyName, target), value);
		return linkTpl(paneHref({ paneType: "filter-eq", persistedAs: this.state.persistedAs, predicate: propertyName, value }), value);
	}

	/** A field's name as a link to the records of this type, ordered by that field. */
	private predicateLink(propertyName: string): TShown {
		const testId = this.predicateLinkCount === 0 ? SHU_TEST_IDS.COLUMN_BROWSER.PREDICATE_LINK_FIRST : SHU_TEST_IDS.COLUMN_BROWSER.PREDICATE_LINK;
		this.predicateLinkCount++;
		return linkTpl(paneHref({ paneType: "filter-prop", persistedAs: this.state.persistedAs, predicate: propertyName }), propertyName, { testId, linkClass: "pred-link" });
	}

	readonly #clock = new ClockController(this);

	/** Show the reading a reader switched to, and read its text where it has not been read. */
	private switchBody(key: string): void {
		this.chosenReading = key;
		this.requestUpdate();
	}
}

defineElement(SHU_TAG.ENTITY_COLUMN, ShuEntityColumn);
