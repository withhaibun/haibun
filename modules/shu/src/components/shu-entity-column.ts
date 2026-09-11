/**
 * <shu-entity-column>: Displays a single individual with edges.
 * Fetches individual+edges via RPC on open. Renders once per navigation.
 * HATEOAS rel-based clickable values. Fully type-agnostic, driven by schema metadata.
 *
 * Events: column-open (entity nav), column-open-filter (filter nav)
 */
import { ellipsize } from "@haibun/core/lib/util/index.js";
import {
	appAccessLevel,
	defaultLabel,
	esc,
	escAttr,
	idOf,
	isVisibleKey,
	isReferenceEdge,
	extractFieldEntries,
	extractBodyLiterals,
	governanceFields,
	pickPreferredBody,
	renderContentHtml,
	utf8ToBase64,
	BODY_READING_STYLE,
} from "../util.js";
import { html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { jsonDisclosure, literalWithJson } from "./json-disclosure.js";
import { shuBaseStyles, shuIconButtonStyles } from "./styles.js";
import { ShuElement, TIME_SYNC_CLASS, type TLinkedData } from "./shu-element.js";
import { SHU_EVENT, ANNOTATION_GLYPH } from "../consts.js";
import { PaneState } from "../pane-state.js";
import { bindCopyButtons, copyButtonHtml } from "../copy-util.js";
import { isReplyEdge, RESOURCE_LABEL, MEDIA_TYPE } from "@haibun/core/lib/resources.js";
import { anIndividual, EntityColumnSchema } from "../schemas.js";
import { EntityController } from "../controllers/index.js";
import type { TEntityResult, TEntityView, TAnnotationDraft } from "../entity-store.js";
import type { AnnotationView } from "../annotation-resolver.js";
import type { TQuoteAnchor } from "@haibun/core/lib/resources.js";
import "./shu-annotated-body.js";
import { getRelSync, getEdgeTargetLabel, getSummaryFields, getIdField, getQueryableFields, getTypeDescription, roleEdgeLabelSet, getDeclaredEdgeLabel } from "../rels-cache.js";
import { propertyVocabulary } from "../graph/ontology-projection.js";
import { openRef } from "./ref-navigation.js";
import { pageAddress } from "../view-hash.js";

type VertexData = Record<string, unknown>;
type EdgeData = { type: string; target: VertexData; direction?: "out" | "in" };

/** Network-free CSP for markdown/plain bodies (text/html opts out; the iframe sandbox still blocks its scripts).
 *  base-uri must admit the app origin or the CSP discards the <base> that makes the body's links work. */
const bodyCsp = (baseOrigin: string): string =>
	`default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri ${baseOrigin || "'none'"}; form-action 'none'`;

export function buildBodyIframeDoc(content: string, mediaType: string, pageUrl = ""): string {
	const baseOrigin = pageUrl ? new URL(pageUrl).origin : "";
	const csp = mediaType === MEDIA_TYPE.html ? "" : `<meta http-equiv="Content-Security-Policy" content="${bodyCsp(baseOrigin)}">`;
	// In a data: document a `#` link resolves against the data: URL and goes nowhere; the base re-roots links against
	// the app and target=_top sends them to the top frame (the iframe sandbox permits user-initiated top navigation).
	const base = pageUrl ? `<base href="${escAttr(pageUrl)}" target="_top">` : "";
	return `<!DOCTYPE html><html><head><meta charset="utf-8">${csp}${base}<style>body{${BODY_READING_STYLE}margin:8px;color:#111;}</style></head><body>${content}</body></html>`;
}

export class ShuEntityColumn extends ShuElement<typeof EntityColumnSchema> {
	static styles = [
		shuBaseStyles,
		shuIconButtonStyles,
		css`
		:host { display: flex; flex-direction: column; height: 100%; overflow: auto; padding: var(--shu-space-3) var(--shu-space-4); font-family: inherit; color: var(--shu-fg); }
		.entity-content { display: flex; flex-direction: column; flex: 1; min-height: 0; }
		.entity-header { padding: var(--shu-space-2) 0; }
		/* A statement about where the view came from, not a control: no border, background or radius, which read as a button. */
		.entity-from-store { align-self: flex-start; margin-bottom: var(--shu-space-1); font-size: var(--shu-font-sm); color: var(--shu-fg-muted); }
		.body-reading { padding: var(--shu-space-3); color: var(--shu-fg-muted); font-style: italic; }
		.entity-type { font-weight: 600; color: var(--shu-accent); font-size: 0.85em; letter-spacing: 0.5px; margin-right: var(--shu-space-4); }
		.entity-id { color: var(--shu-fg-muted); word-break: break-all; }
		.entity-type-description { color: var(--shu-fg-muted); font-size: 0.85em; padding: var(--shu-space-1) 0; }
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
		.detail-toggle { cursor: pointer; color: var(--shu-fg-faded); font-size: 0.8em; padding: var(--shu-space-1) 0; }
		.detail-toggle:hover { color: var(--shu-fg-muted); }
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
		.content-switch-btn.active { background: var(--shu-accent); border-color: var(--shu-accent); color: var(--shu-accent-fg); }
		.hidden { display: none; }
		.detail-table { width: 100%; border-collapse: collapse; }
		.detail-table td { padding: 1px var(--shu-space-2); vertical-align: top; }
		.fields-table { margin: var(--shu-space-1) 0 var(--shu-space-2); }
		.field-json { margin: 0; padding: var(--shu-space-2); background: var(--shu-bg-soft); border-radius: var(--shu-radius); font-size: 0.8em; white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
		.literal-body { margin: var(--shu-space-2) 0 0; padding: var(--shu-space-2); background: var(--shu-bg-soft); border-radius: var(--shu-radius); white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
		.field-name { white-space: nowrap; color: var(--shu-fg-faded); width: 80px; font-size: 0.85em; }
		/* Provenance mark (from the served @context): a standard/consumer vocabulary shows its prefix; haibun's own reads faint. */
		.vocab { font-size: 0.7em; margin-left: 2px; padding: 0 2px; border-radius: 2px; vertical-align: super; }
		.vocab-standard { color: var(--shu-accent); background: var(--shu-accent-soft); }
		.vocab-haibun { color: var(--shu-fg-faded); }
		.body-container { display: flex; flex-direction: column; flex: 1; min-height: 200px; }
		.body-iframe { width: 100%; height: 100%; min-height: 200px; border: none; background: #fff; }
		/* Locally-rendered (black-on-white) bodies invert in dark themes so they read natively; a text/html body is
		   the original document with its own colours and never inverts (see renderContentIframe). */
		.body-iframe.invertible { filter: invert(var(--shu-invert, 0)) hue-rotate(calc(var(--shu-invert, 0) * 180deg)); }
		.error-banner { padding: var(--shu-space-3) var(--shu-space-4); margin: var(--shu-space-2); background: var(--shu-bg-error-soft); color: var(--shu-error); border-radius: var(--shu-radius); }
		.loading, .empty { color: var(--shu-fg-faded); padding: var(--shu-space-4); }
		`,
	];
	/** The showAnnotations toggle is remembered per column across reloads, like every persisted view option. */
	static persistFields = ["showAnnotations"] as const;

	private vertex: VertexData | null = null;
	private edges: EdgeData[] = [];
	private incomingCount = 0;
	private predicateLinkCount = 0;
	private edgeTargetCount = 0;
	/** Annotations anchored in the open individual's body, projected from the entity view; empty until resolved. */
	private annotationsList: AnnotationView[] = [];
	/** A passage to reveal once the body renders, set by a Text Fragment reference into this individual. */
	private revealTarget: TQuoteAnchor | null = null;
	/** The text of each body that has been read, by body id, projected from the entity view. A body the reader has not
	 *  opened is absent, so the body area reads as loading rather than empty. */
	private bodyText: Record<string, string> = {};
	/** Full augmented products from getIndividualWithEdges (individual + edges + incomingCount + `_type/_summary/_description/_links/_seqPath`). Retained for the `<script type="application/ld+json">` block in render so an agent reading the page sees the same hypermedia, and returned on demand by `summarizeForKihan`. */
	private products: Record<string, unknown> | null = null;

	/** The open individual's full hypermedia products, the same linked data the page embeds, with any body text the reader has opened merged into the existing `hasBody` entries (the projection lists a body's id and mediaType; `content` is the same field `bodyByMediaType` reads). Null only while the products are still loading. */
	summarizeForKihan(): TLinkedData | null {
		if (!this.products) return null;
		const hasBody = this.products.hasBody;
		if (!Array.isArray(hasBody)) return this.products;
		const withText = (b: { id?: unknown; content?: unknown }) => {
			const content = this.bodyText[String(b.id ?? "")];
			return content && b.content === undefined ? { ...b, content } : b;
		};
		return { ...this.products, hasBody: hasBody.map(withText) };
	}
	/** The one data path for this individual: its entity, the annotations anchored in it, and how it resolved (live /
	 *  cache / offline), kept fresh over SSE. The column never fetches / falls back / reloads annotations itself. */
	private readonly entity = new EntityController(this, (view) => this.applyView(view));

	constructor() {
		super(EntityColumnSchema, {
			individualId: "",
			persistedAs: "",
			loading: false,
		});
	}

	protected override onTimeSync(): void {
		const container = this.shadowRoot?.querySelector(".container");
		if (!container) return;
		const ts = this.extractTimestamp(this.vertex ?? {}, this.state.persistedAs);
		if (ts !== null && this.isFuture(ts)) {
			container.classList.add(TIME_SYNC_CLASS.FUTURE);
		} else {
			container.classList.remove(TIME_SYNC_CLASS.FUTURE);
		}
	}

	/** Render arbitrary products as an individual view without RPC fetch. Releases the entity handle: these products are
	 *  the view now, so a live change to the individual last opened here must not replace them. */
	openProducts(products: Record<string, unknown>): void {
		this.entity.release();
		const label = String(products._type || "Result");
		const { _type, _summary, _component, _links, _undo, _seqPath, ...data } = products;
		this.vertex = data;
		this.edges = [];
		this.incomingCount = 0;
		this.products = products;
		this.annotationsList = [];
		this.setState({ individualId: String(_summary || ""), persistedAs: label, loading: false, fromStore: undefined });
	}

	/** Write a note the reader authored in the body, and re-resolve so it reads back anchored. The body reports what was
	 *  selected and written; the individual (and the entity handle that reaches it) is the column's, so the write is too. */
	private readonly annotateDraft = (draft: TAnnotationDraft): Promise<{ ok: true } | { ok: false; error: string }> => this.entity.annotate(draft);

	/** Project the entity handle's view onto the render fields: the entity (applied for the field table/roles/body), the
	 *  annotations anchored in it, the text of any body already read, and the loading/error/provenance state the render
	 *  branches read. */
	private applyView(view: TEntityView): void {
		if (view.entity) this.applyEntity(view.entity);
		this.annotationsList = view.annotations;
		this.bodyText = view.bodies;
		this.setState({
			loading: view.status === "loading",
			error: view.status === "error" ? view.error : undefined,
			fromStore: view.provenance === "cache" || view.provenance === "offline" ? view.provenance : undefined,
		});
		// Read the body the reader is shown, only that one, only once (the handle no-ops for a body already read).
		const bodyId = this.activeBodyId();
		if (bodyId && view.bodies[bodyId] === undefined) this.entity.requestBody(bodyId);
	}

	/** Apply one entity result (from the shared store or a fresh fetch) to the render fields. */
	private applyEntity(result: TEntityResult): void {
		this.vertex = result.vertex;
		this.edges = (result.edges as EdgeData[]) ?? [];
		this.incomingCount = result.incomingCount ?? 0;
		this.products = result as unknown as Record<string, unknown>;
	}

	/** Reveal a quoted passage in the already-open individual: the re-request path of a Text Fragment reference. */
	revealPassage(selector: TQuoteAnchor): void {
		this.revealTarget = selector;
		this.setState({ showAnnotations: true });
	}

	/** Open an individual by ID through the entity handle: it serves a cached copy at once, else fetches (then falls back
	 *  to the persisted browser store when offline), and resolves the annotations anchored in it: one path, one shared
	 *  copy and one live subscription per individual. `applyView` projects each resolved state onto the render fields. */
	async open(id: string, label: string = defaultLabel(), selector?: TQuoteAnchor): Promise<void> {
		// Surface the subject as an attribute so external code (e.g. the COLUMN_CLOSE
		// listener in app.ts) can detect which entity is in this column without
		// reaching through the protected `state` field.
		this.setAttribute("data-subject", id);
		if (selector) this.revealPassage(selector);
		this.setState({ individualId: id, persistedAs: label, error: undefined });
		const accessLevel = appAccessLevel();
		await this.entity.open(label, id, accessLevel);
		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, {
				detail: { patterns: [anIndividual(label, id)], accessLevel, label },
				bubbles: true,
				composed: true,
			}),
		);
	}

	render(): TemplateResult {
		const { loading, error, persistedAs } = this.state;
		this.predicateLinkCount = 0;
		this.edgeTargetCount = 0;

		if (loading) {
			const { individualId: vid, persistedAs: lbl } = this.state;
			return html`<shu-spinner .status=${`Fetching ${lbl} ${vid.slice(0, 30)}...`} .visible=${true}></shu-spinner>`;
		}
		if (error) return html`<div class="error-banner">${error}</div>`;
		if (!this.vertex) {
			const msg = this.state.individualId ? `Vertex not found: ${this.state.individualId}` : "";
			return msg ? html`<div class="error-banner">${msg}</div>` : html`<shu-spinner status="Waiting..." visible></shu-spinner>`;
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
		const typeLine = this.typeDescriptionLine(persistedAs);

		let contentHtml: string;
		if (isStub) {
			const id = idOf(this.vertex);
			const stubDetails = this.typeDisclosure(persistedAs, typeLine);
			contentHtml = `<div class="entity-header" data-testid="entity-stub"><span class="entity-type">${esc(persistedAs)}</span><span class="entity-id">${esc(id)}</span></div>${stubDetails}${this.renderRoles()}${this.renderReferences()}`;
		} else {
			const summaryFields = getSummaryFields(persistedAs);
			// Every non-summary, non-edge scalar field, shown in full between the type disclosure and the body. Object
			// values render as formatted JSON. Body-presentation content (a SeqPath's stepText) renders below via bodyLiterals.
			const detailRows = Object.entries(fields)
				.filter(([k]) => !getEdgeTargetLabel(k, persistedAs) && !summaryFields.has(k))
				.map(([k, v]) => {
					if (this.isTypeField(k)) return this.typeRow(k, v);
					const valueHtml = Array.isArray(v) ? v.map((item) => this.formatFieldValue(item, k)).join(", ") : this.formatFieldValue(v, k);
					return `<tr><td class="field-name">${this.clickableValue(k, "describedby")}${this.vocabBadge(k)}</td><td data-testid="entity-field-${escAttr(k)}">${valueHtml}</td></tr>`;
				})
				.join("");
			// The disclosure carries only the type name (its summary) and description; the fields themselves sit below it.
			const detailsHtml = this.typeDisclosure(persistedAs, typeLine);
			const fieldsHtml = detailRows ? `<table class="detail-table fields-table" data-testid="entity-fields">${detailRows}</table>` : "";
			const summaryHtml =
				summaryFields.size > 0
					? `<div class="entity-summary" data-testid="entity-summary">${Array.from(summaryFields)
							.filter((k) => fields[k] && (Array.isArray(fields[k]) ? (fields[k] as string[]).length > 0 : true))
							.map((k) => {
								const v = fields[k];
								const valueHtml = Array.isArray(v) ? v.map((item) => this.fieldValueHtml(item, k)).join(", ") : this.fieldValueHtml(v, k);
								return `<span class="summary-field" data-testid="entity-field-${escAttr(k)}">${this.clickableValue(k, "describedby")}${this.vocabBadge(k)} ${valueHtml}</span>`;
							})
							.join(" ")}</div>`
					: "";
			// The body area (iframe or inline-annotated) is rendered as a lit sub-template after this string, so annotations
			// reach shu-annotated-body as a real property rather than an attribute, hence contentIframe is NOT embedded here.
			contentHtml = `${detailsHtml}${summaryHtml}${this.renderRoles()}${fieldsHtml}${this.renderItemsTable()}${this.renderReferences()}${governance}${bodyLiterals}`;
		}

		return html`${unsafeHTML(this.emitHypermediaScript(this.products))}${this.renderColumnSettings()}<div class="entity-content">${this.renderFromStore()}${unsafeHTML(contentHtml)}${this.renderBodyArea(contentIframe)}</div>`;
	}

	protected updated(): void {
		if (!this.state.loading && !this.state.error && this.vertex) this.bindEvents();
	}

	/** Where the view came from when it was not fetched: a copy held this session, or the browser store when offline.
	 *  Absent for a live fetch, so its presence tells a reader why the view appeared without one. */
	private renderFromStore(): TemplateResult {
		const { fromStore } = this.state;
		if (!fromStore) return html``;
		const label = fromStore === "offline" ? "from the browser store (offline)" : "from a copy held this session";
		return html`<div class="entity-from-store" data-testid="entity-from-store">${label}</div>`;
	}

	// The type's description, shown inside the disclosure (the type name itself is the disclosure summary). Empty for an ad-hoc result view with no registered type.
	private typeDescriptionLine(persistedAs: string): string {
		const desc = getTypeDescription(persistedAs);
		if (!desc) return "";
		return `<div class="entity-type-description" data-testid="entity-type-description">${esc(desc)}</div>`;
	}

	// The type disclosure: its summary is the type name as a link to the type's own view (description, schema, individuals:
	// the same navigation a @type value and a #Type reference use); its body is the type description.
	private typeDisclosure(persistedAs: string, typeLine: string): string {
		if (!typeLine) return "";
		const link = `<a class="col-link" rel="type-ref" href="#" data-value="${escAttr(persistedAs)}" data-testid="entity-type-link">${esc(persistedAs)}</a>`;
		return `<details class="entity-detail" open data-testid="entity-details"><summary class="detail-toggle">${link}</summary>${typeLine}</details>`;
	}

	/** Render arrays of objects as tables (e.g. show domains items). Skips `hasBody` (rendered as iframes), JSON-LD keywords, and underscore-projected keys. */
	private renderItemsTable(): string {
		if (!this.vertex) return "";
		const { persistedAs } = this.state;
		const tables: string[] = [];
		for (const [k, v] of Object.entries(this.vertex)) {
			if (!isVisibleKey(k, persistedAs)) continue;
			if (!Array.isArray(v) || v.length === 0 || typeof v[0] !== "object") continue;
			const items = v as Record<string, unknown>[];
			// Inner table: items don't have a per-row label, fall back to projection-only filter.
			const keys = Object.keys(items[0]).filter((key) => isVisibleKey(key));
			const header = keys.map((key) => `<th>${esc(key)}</th>`).join("");
			const rows = items
				.map(
					(item) =>
						`<tr>${keys
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

	/** Render a clickable edge target with label from HATEOAS edge range. */
	private renderEdgeTarget(target: VertexData, edgeType: string): string {
		const id = idOf(target);
		const rangeLabel = getEdgeTargetLabel(edgeType, this.state.persistedAs);
		const label = (rangeLabel === RESOURCE_LABEL ? undefined : rangeLabel) ?? (target["@type"] as string) ?? defaultLabel();
		const display = String(target.name ?? target.email ?? target.filename ?? target.subject ?? id);
		const testId = this.edgeTargetCount === 0 ? ' data-testid="edge-target-first"' : "";
		this.edgeTargetCount++;
		return `<a class="col-link" rel="item" href="#" data-value="${escAttr(id)}" data-label="${escAttr(label)}"${testId}>${esc(ellipsize(display, 60))}</a>`;
	}

	/** Plain-language names for the roles CORE's own general rels name. A consumer edge's phrase comes from its declared
	 *  edge label in the concern catalog (getDeclaredEdgeLabel): no consumer vocabulary is named here. */
	private static readonly ROLE_PHRASE: Record<string, string> = {
		delegatedFrom: "Delegated from",
		delegator: "Delegated by",
		performedBy: "Performed by",
		controller: "Controlled by",
		wasAttributedTo: "Attributed to",
		attributedTo: "Attributed to",
		author: "Written by",
	};

	/** The node's roles in plain language, who plays what role toward it, so the roles are explained rather than left
	 *  as raw rels. Reads the role edges (rels-cache roleEdgeLabelSet). A role is one fact per (rel, party), so a rel
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

		if (outgoing.length === 0 && this.incomingCount === 0) return "";

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
				([type, items]) => `
				<div class="ref-group">
					<span class="ref-type">${esc(type)}</span>
					${items.map((i) => this.renderEdgeTarget(i.target, i.edgeType)).join(", ")}
				</div>`,
			)
			.join("");

		const inHtml = this.incomingCount > 0 ? `<a class="section-label links-here-link" href="#">What links here <span class="ref-count">(${this.incomingCount})</span></a>` : "";
		const hasReplies = this.edges.some((e) => isReplyEdge(e.type)) || this.incomingCount > 0;
		const replyHtml = hasReplies ? `<a class="section-label thread-link" href="#">View replies</a>` : "";

		return `<div class="references" data-testid="ref-section">${outHtml}${inHtml}${replyHtml}</div>`;
	}

	/**
	 * Render the linked Body sub-resources (`vertex.hasBody`) as a single
	 * content iframe with a switcher if multiple formats exist. Dispatches
	 * on each Body's `mediaType` triple, same path for Comment markdown,
	 * Email plain/html/markdown, Proposal rationale, File markdown, etc.
	 */
	private renderContentIframe(_persistedAs: string): string {
		const vertex = this.vertex;
		if (!vertex) return "";
		// The record NAMES its bodies (id + media type); their text is read on request, so the switcher is drawn from the
		// listing and the active body's text appears once it has been read.
		const available = this.linkedBodies().filter((b) => typeof b.mediaType === "string");
		if (available.length === 0) return "";

		const active = pickPreferredBody(available) ?? available[0];
		const activeId = String(active.id ?? "");

		const switcherHtml =
			available.length > 1
				? `<div class="content-switcher">${available
						.map(
							(b) =>
								`<button class="content-switch-btn${String(b.id ?? "") === activeId ? " active" : ""}" data-body-id="${escAttr(String(b.id ?? ""))}">${esc(String(b.mediaType))}</button>`,
						)
						.join("")}</div>`
				: "";
		// Text this view was HANDED (a step's products carry their own body) needs no request; otherwise it is the text
		// read on request, and until that lands the body area says it is reading rather than showing an empty frame.
		const raw = active.content ?? this.bodyText[activeId];
		if (raw === undefined)
			return `<div class="body-container"><div class="content-toolbar">${switcherHtml}</div><div class="body-reading" data-testid="body-reading">Reading ${esc(String(active.mediaType))}…</div></div>`;
		if (raw === "") return ""; // a body with nothing in it: show nothing, not an empty frame
		const content = renderContentHtml(raw, String(active.mediaType));
		const encoded = utf8ToBase64(buildBodyIframeDoc(content, String(active.mediaType), pageAddress()));
		const invertible = String(active.mediaType) !== "text/html" ? " invertible" : "";
		const iframeHtml = `<iframe class="body-iframe${invertible}" data-body-id="${escAttr(activeId)}" sandbox="allow-same-origin allow-top-navigation-by-user-activation" src="data:text/html;base64,${encoded}" data-testid="email-body-iframe"></iframe>`;

		const copyBtn = copyButtonHtml(raw);
		const annotateBtn = this.annotatableBody() ? this.annotateButtonHtml(false) : "";
		const toolbar = `<div class="content-toolbar">${switcherHtml}${copyBtn}${annotateBtn}</div>`;
		return `<div class="body-container">${toolbar}${iframeHtml}</div>`;
	}

	/** The bodies this record links, as it names them: id + media type. `content` is absent from a graph read (a body's
	 *  text is read on request); it is present only when this view was handed products that carry their own. */
	private linkedBodies(): Array<{ id?: string; mediaType?: string; content?: string }> {
		const raw = this.vertex?.hasBody;
		return (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<{ id?: string; mediaType?: string; content?: string }>;
	}

	/** The body the reader is shown, the preferred format, and the one whose text is to read. */
	private activeBodyId(): string {
		const available = this.linkedBodies().filter((b) => typeof b.mediaType === "string");
		if (available.length === 0) return "";
		return String((pickPreferredBody(available) ?? available[0]).id ?? "");
	}

	/** The human-readable text body (markdown / plain) an annotation's quote is anchored against, rendered inline so
	 *  the annotator can highlight it. Null when the individual has only a non-text body (e.g. an original HTML email),
	 *  which stays in the sandboxed iframe with a notes list instead. */
	private annotatableBody(): { content: string; mediaType: string } | null {
		const b = this.linkedBodies().find((x) => x.mediaType === MEDIA_TYPE.markdown || x.mediaType === MEDIA_TYPE.plain);
		const content = b ? (b.content ?? this.bodyText[String(b.id ?? "")]) : undefined;
		return b && content !== undefined ? { content, mediaType: String(b.mediaType) } : null;
	}

	/** The annotation-gutter toggle for the body toolbar, identical markup in the iframe and inline paths so the two
	 *  never drift. `active` is whether the gutter is currently open (drives the pane-icon aria-pressed highlight); the
	 *  `has-annotations` class colours the pencil glyph, greyscale otherwise. */
	private annotateButtonHtml(active: boolean): string {
		const has = this.annotationsList.length > 0;
		const title = active ? "Hide annotations" : has ? "Show annotations" : "Add annotations";
		return `<button class="pane-icon annotate-enter${has ? " has-annotations" : ""}" data-testid="annotate-enter" type="button" aria-pressed="${active}" title="${title}"><span class="anno-glyph">${ANNOTATION_GLYPH}</span></button>`;
	}

	/** Show or hide the annotation gutter. On with no annotations yet enters authoring (the inline view needs a note or
	 *  a draft to show); off also drops any pending passage reveal, since the reveal renders in the gutter. */
	private toggleAnnotationGutter(show: boolean): void {
		if (!show) this.revealTarget = null;
		this.setState({ showAnnotations: show, annotateMode: show && this.annotationsList.length === 0 });
	}

	/** The body area. A text body (markdown / plain) that carries annotations, with the gutter on (the default when any
	 *  exist), renders inline via shu-annotated-body: the passages highlighted and the notes shown in a margin rail
	 *  beside them, the toolbar's pencil toggling back to the plain iframe. Any other case (no annotations, gutter off, or a
	 *  non-text body such as an original HTML email) keeps the sandboxed body iframe, whose pencil toggles the gutter on. */
	private renderBodyArea(iframeHtml: string): TemplateResult {
		if (!iframeHtml) return html``;
		const annBody = this.annotatableBody();
		const showInline = annBody && this.state.showAnnotations && (this.annotationsList.length > 0 || this.state.annotateMode || this.revealTarget !== null);
		if (showInline && annBody) {
			return html`<div class="content-toolbar">
					${unsafeHTML(copyButtonHtml(annBody.content))}${unsafeHTML(this.annotateButtonHtml(true))}
				</div>
				<shu-annotated-body
					data-testid="annotated-body"
					.content=${annBody.content}
					.mediaType=${annBody.mediaType}
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

	/**
	 * Render literal body-presentation content: an inline scalar whose rel has presentation `body` (a SeqPath's
	 * `stepText`, mapped to `content`), as plain text blocks in the body area. isVisibleKey routes body-presentation
	 * fields out of the field table, but renderContentIframe only handles linked `hasBody` sub-resources, so a literal
	 * `content` value would otherwise render nowhere.
	 */
	/** The record's governance fields (who may see it, what it allows, whether it is revoked) in their own section.
	 *  The field table drops them (their rel says they belong here), so without this they render nowhere at all. */
	private renderGovernance(persistedAs: string): string {
		if (!this.vertex) return "";
		const fields = governanceFields(this.vertex, persistedAs);
		const rows = Object.entries(fields)
			.map(([k, v]) => `<div class="field-row"><span class="field-name">${esc(k)}</span><span class="field-value">${this.fieldValueHtml(v, k)}</span></div>`)
			.join("");
		return rows ? `<details class="governance" open data-testid="entity-governance"><summary class="section-label">Governance</summary>${rows}</details>` : "";
	}

	private renderBodyLiterals(persistedAs: string): string {
		if (!this.vertex) return "";
		return Object.entries(extractBodyLiterals(this.vertex, persistedAs))
			.map(([k, v]) => `<div class="literal-body" data-testid="entity-body-${escAttr(k)}">${literalWithJson(v)}</div>`)
			.join("");
	}

	/**
	 * Render a field's value with the right navigation affordance:
	 *   - the idField → an entity-open link (rel="item") back to this individual via
	 *     getIndividualWithEdges (the idField is never a query filter, so a filter
	 *     route would throw "filter fields not declared");
	 *   - a server-declared queryable field → a filter link;
	 *   - everything else → plain display-only text (no navigation).
	 * Edge-valued fields are handled inside clickableValue via the "item" rel.
	 */
	/** A field's value formatted for the visible field table: an object or array is shown as disclosures a reader opens;
	 *  everything else falls through to fieldValueHtml (its navigation affordance + escaping). */
	private formatFieldValue(value: string, propertyName: string): string {
		const trimmed = value.trim();
		if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
			try {
				return `<div class="field-json" data-testid="field-json-${escAttr(propertyName)}">${jsonDisclosure(JSON.parse(trimmed))}</div>`;
			} catch {
				// not valid JSON, render as an ordinary scalar
			}
		}
		return this.fieldValueHtml(value, propertyName);
	}

	private fieldValueHtml(value: string, propertyName: string): string {
		const label = this.state.persistedAs;
		if (getRelSync(label, propertyName) === "item") return this.clickableValue(value, "filter", propertyName);
		if (propertyName === getIdField(label)) {
			const id = idOf(this.vertex ?? {});
			return `<a class="col-link" rel="item" href="#" data-value="${escAttr(id)}" data-label="${escAttr(label)}" data-property="${escAttr(propertyName)}">${esc(ellipsize(value, 80))}</a>`;
		}
		if (getQueryableFields(label).includes(propertyName)) return this.clickableValue(value, "filter", propertyName);
		return esc(ellipsize(value, 80));
	}

	/** The type's scoped @context (field → {@id, @type?}) from the served hypermedia: the server resolves each field to
	 *  its genuine vocabulary IRI here, so the view reads provenance/representation from it rather than guessing. Undefined
	 *  for an ad-hoc view with no served context. */
	private scopedContext(): Record<string, { "@id"?: string; "@type"?: string }> | undefined {
		const ctx = this.vertex?.["@context"] as Record<string, unknown> | undefined;
		type TScopedField = { "@id"?: string; "@type"?: string };
		const inner = (ctx?.[this.state.persistedAs] as { "@context"?: unknown } | undefined)?.["@context"];
		// A type conforming to standard context(s) serves its scoped @context as a JSON-LD 1.1 array [url…, {haibun terms}];
		// the field definitions this view marks are in the object member (the last element). A plain object stands alone.
		if (Array.isArray(inner)) return inner.find((p): p is Record<string, TScopedField> => typeof p === "object" && p !== null && !Array.isArray(p));
		return inner as Record<string, TScopedField> | undefined;
	}

	/** A provenance mark on a field name, from the served @context's genuine IRI for the field: haibun's own reads faint,
	 *  a standard/consumer vocabulary shows its prefix (prov/schema/…). Empty when the context omits the field. */
	private vocabBadge(propertyName: string): string {
		const iri = this.scopedContext()?.[propertyName]?.["@id"];
		if (!iri) return "";
		const v = propertyVocabulary(iri);
		return `<sup class="vocab vocab-${v.source}" data-testid="vocab-${escAttr(propertyName)}" title="${escAttr(v.source === "haibun" ? "haibun vocabulary" : `${v.prefix} vocabulary`)}">${esc(v.prefix)}</sup>`;
	}

	/** True when the served @context aliases this field to the JSON-LD `@type` keyword, whose values are the entity's
	 *  classes rather than ordinary data. */
	private isTypeField(propertyName: string): boolean {
		return this.scopedContext()?.[propertyName]?.["@id"] === "@type";
	}

	/** Render the rdf:type field the standard JSON-LD way: named `@type`, its values the entity's classes: each a link
	 *  that opens the class's type column, so an entity carrying several classes has each one explorable. */
	private typeRow(propertyName: string, value: string | string[]): string {
		const classes = Array.isArray(value) ? value : [value];
		const links = classes
			.filter((c) => c)
			.map((c) => `<a class="col-link" rel="type-ref" href="#" data-value="${escAttr(c)}" data-testid="type-value">${esc(c)}</a>`)
			.join(", ");
		return `<tr><td class="field-name">@type</td><td data-testid="entity-field-${escAttr(propertyName)}">${links}</td></tr>`;
	}

	private clickableValue(value: string, rel: string, propertyName?: string): string {
		// Use HATEOAS rels + edge ranges to determine navigation semantics
		let labelAttr = "";
		let resolvedValue = value;
		if (rel === "filter" && propertyName) {
			const serverRel = getRelSync(this.state.persistedAs, propertyName);
			if (serverRel === "item") {
				rel = "item";
				const targetLabel = getEdgeTargetLabel(propertyName, this.state.persistedAs);
				if (targetLabel && targetLabel !== RESOURCE_LABEL) {
					labelAttr = ` data-label="${escAttr(targetLabel)}"`;
					// Resolve entity ID from edge target data: the graph edge
					// carries the actual target node with its ID field, regardless of type
					const edge = this.edges.find((e) => e.type === propertyName && e.direction === "out");
					if (edge?.target) resolvedValue = idOf(edge.target);
				}
			}
		}
		const isPredicate = rel === "describedby";
		let testId = "";
		if (isPredicate) {
			testId = this.predicateLinkCount === 0 ? ' data-testid="predicate-link-first"' : ' data-testid="predicate-link"';
			this.predicateLinkCount++;
		}
		const propAttr = propertyName ? ` data-property="${escAttr(propertyName)}"` : "";
		const linkClass = isPredicate ? "pred-link" : "col-link";
		return `<a class="${linkClass}" rel="${rel}" href="#" data-value="${escAttr(resolvedValue)}"${labelAttr}${propAttr}${testId}>${esc(ellipsize(value, 80))}</a>`;
	}

	// One delegated click listener on the shadow root, attached once. The content is `unsafeHTML` (a raw string lit does
	// NOT rebuild while unchanged), so a per-node addEventListener in `updated()` (which runs on every render) accumulated
	// a fresh listener on each surviving link: one click then fired N times, opening N duplicate panes. Delegation binds
	// one stable listener to the shadow root, which addEventListener dedups by identity, so re-binding every render is a
	// no-op by spec.

	private onShadowClick = (e: Event): void => {
		const t = e.target as Element | null;
		if (!t) return;
		const link = t.closest(".col-link, .pred-link") as HTMLElement | null;
		if (link) return this.routeLinkClick(link, e);
		const switchBtn = t.closest(".content-switch-btn") as HTMLElement | null;
		if (switchBtn) return this.switchBody(switchBtn);
		if (t.closest(".links-here-link")) {
			e.preventDefault();
			PaneState.request({ paneType: "filter-incoming", persistedAs: this.state.persistedAs, subject: this.state.individualId });
			return;
		}
		if (t.closest(".thread-link")) {
			e.preventDefault();
			PaneState.request({ paneType: "thread", persistedAs: this.state.persistedAs, subject: this.state.individualId });
		}
	};

	private routeLinkClick(target: HTMLElement, e: Event): void {
		e.preventDefault();
		e.stopPropagation();
		const value = target.dataset.value;
		const rel = target.getAttribute("rel");
		const propertyName = target.dataset.property;
		if (!value) return;
		// Target label comes from data-label (set at render time by HATEOAS rels + edge ranges)
		const targetLabel = target.dataset.label || this.state.persistedAs;
		switch (rel) {
			case "item":
				this.dispatchEvent(
					new CustomEvent(SHU_EVENT.COLUMN_OPEN, {
						detail: { subject: value, label: targetLabel, addToSelection: (e as MouseEvent).ctrlKey || (e as MouseEvent).shiftKey || (e as MouseEvent).metaKey },
						bubbles: true,
						composed: true,
					}),
				);
				break;
			case "describedby":
				PaneState.request({ paneType: "filter-prop", persistedAs: this.state.persistedAs, predicate: value });
				break;
			case "type-ref":
				// A class from the @type row, open its type view through the shared hypermedia ref router (a domain
				// reference), the same navigation a #Type link and a graph class-click use.
				openRef(e, "domain", { domain: value });
				break;
			default:
				if (propertyName) PaneState.request({ paneType: "filter-eq", persistedAs: this.state.persistedAs, predicate: propertyName, value });
				break;
		}
	}

	// Body switcher button, dispatch on the linked Body's mediaType.
	private switchBody(btn: HTMLElement): void {
		const bodyId = btn.dataset.bodyId;
		if (!bodyId || !this.vertex) return;
		this.shadowRoot?.querySelectorAll(".content-switch-btn").forEach((b) => b.classList.remove("active"));
		btn.classList.add("active");
		const bodies = (this.vertex.hasBody as Array<{ id?: string; content?: string; mediaType?: string }> | undefined) ?? [];
		const body = bodies.find((b) => String(b.id ?? "") === bodyId);
		if (!body || typeof body.content !== "string" || typeof body.mediaType !== "string") return;
		const iframe = this.shadowRoot?.querySelector(".body-iframe") as HTMLIFrameElement | null;
		if (iframe) {
			iframe.dataset.bodyId = bodyId;
			iframe.classList.toggle("invertible", body.mediaType !== "text/html");
			iframe.src = `data:text/html;base64,${utf8ToBase64(buildBodyIframeDoc(renderContentHtml(body.content, body.mediaType), body.mediaType, pageAddress()))}`;
		}
	}

	private bindEvents(): void {
		this.shadowRoot?.addEventListener("click", this.onShadowClick);

		bindCopyButtons(this.shadowRoot as ShadowRoot);
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
