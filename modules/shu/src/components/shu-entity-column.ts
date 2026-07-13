/**
 * <shu-entity-column> — Displays a single individual with edges.
 * Fetches individual+edges via RPC on open. Renders once per navigation.
 * HATEOAS rel-based clickable values. Fully type-agnostic — driven by schema metadata.
 *
 * Events: column-open (entity nav), column-open-filter (filter nav)
 */
import {
	appAccessLevel,
	defaultLabel,
	esc,
	escAttr,
	truncate,
	idOf,
	isVisibleKey,
	isReferenceEdge,
	extractFieldEntries,
	pickPreferredBody,
	renderContentHtml,
	utf8ToBase64,
} from "../util.js";
import { html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { shuBaseStyles } from "./styles.js";
import { ShuElement, TIME_SYNC_CLASS } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { PaneState } from "../pane-state.js";
import { bindCopyButtons, copyButtonHtml } from "../copy-util.js";
import { isReplyEdge, RESOURCE_LABEL, roleRels } from "@haibun/core/lib/resources.js";
import { hasEventStream } from "../event-stream.js";
import { EntityColumnSchema } from "../schemas.js";
import { callStep } from "../pane-fetch.js";
import { derefStoredEntity } from "../quads-snapshot.js";
import { getCachedEntity, setCachedEntity, subscribeEntities, type TEntityResult } from "../entity-store.js";
import { getRelSync, getEdgeTargetLabel, getSummaryFields, getIdField, getQueryableFields, getTypeDescription } from "../rels-cache.js";
import { propertyVocabulary } from "../graph/ontology-projection.js";
import { openRef } from "./ref-navigation.js";

type VertexData = Record<string, unknown>;
type EdgeData = { type: string; target: VertexData; direction?: "out" | "in" };

/** Markdown/plain bodies are rendered locally for a clean, private view — this CSP makes them load NOTHING from the network (no remote images/tracking pixels, fonts, scripts, frames, or fetches); only inline `data:` images and the inline body style are permitted. text/html bodies are the original message and opt out so their remote assets load (scripts stay blocked by the iframe sandbox regardless). */
const BODY_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";

export function buildBodyIframeDoc(content: string, mediaType: string): string {
	const csp = mediaType === "text/html" ? "" : `<meta http-equiv="Content-Security-Policy" content="${BODY_CSP}">`;
	return `<!DOCTYPE html><html><head><meta charset="utf-8">${csp}<style>body{font-family:sans-serif;font-size:14px;margin:8px;color:#111;}</style></head><body>${content}</body></html>`;
}

export class ShuEntityColumn extends ShuElement<typeof EntityColumnSchema> {
	static styles = [
		shuBaseStyles,
		css`
		:host { display: flex; flex-direction: column; height: 100%; overflow: auto; padding: var(--shu-space-3) var(--shu-space-4); font-family: inherit; color: var(--shu-fg); }
		.entity-content { display: flex; flex-direction: column; flex: 1; min-height: 0; }
		.entity-header { padding: var(--shu-space-2) 0; }
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
		.content-toolbar { display: flex; gap: var(--shu-space-2); padding: var(--shu-space-1) 0; align-items: center; }
		.content-switcher { display: flex; gap: var(--shu-space-2); }
		.content-switch-btn { font-size: 0.75em; padding: 1px var(--shu-space-3); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); cursor: pointer; background: var(--shu-bg-elevated); color: var(--shu-fg-muted); }
		.content-switch-btn.active { background: var(--shu-accent); border-color: var(--shu-accent); color: var(--shu-accent-fg); }
		.hidden { display: none; }
		.detail-table { width: 100%; border-collapse: collapse; }
		.detail-table td { padding: 1px var(--shu-space-2); vertical-align: top; }
		.fields-table { margin: var(--shu-space-1) 0 var(--shu-space-2); }
		.field-json { margin: 0; padding: var(--shu-space-2); background: var(--shu-bg-soft); border-radius: var(--shu-radius); font-size: 0.8em; white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
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
	private vertex: VertexData | null = null;
	private edges: EdgeData[] = [];
	private incomingCount = 0;
	private predicateLinkCount = 0;
	private edgeTargetCount = 0;
	/** Full augmented products from getIndividualWithEdges (individual + edges + incomingCount + `_type/_summary/_description/_links/_seqPath`). Retained for the `<script type="application/ld+json">` block in render so the chat-context harvester sees the same hypermedia an agent following `_links` would. */
	private products: Record<string, unknown> | null = null;

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

	/** Render arbitrary products as an individual view without RPC fetch. */
	openProducts(products: Record<string, unknown>): void {
		const label = String(products._type || "Result");
		const { _type, _summary, _component, _links, _undo, _seqPath, ...data } = products;
		this.vertex = data;
		this.edges = [];
		this.incomingCount = 0;
		this.products = products;
		this.setState({ individualId: String(_summary || ""), persistedAs: label, loading: false });
	}

	/** Live-refresh: the open individual is held in the shared entity store, which merges live observations (e.g. a gantt
	 *  bar dragged to a new time emits an observation for its startedAtTime) into the cached copy. We re-render from that
	 *  copy rather than re-fetching — one client copy, updated in place, no per-change RPC. */
	protected override onConnected(): void {
		if (!hasEventStream()) return; // static context (offline report, unit test without live events) — nothing to subscribe to
		this.autoTeardown(
			subscribeEntities((subject) => {
				if (subject !== this.state.individualId) return;
				const fresh = getCachedEntity(this.state.persistedAs, subject);
				if (fresh) {
					this.applyEntity(fresh);
					this.requestUpdate();
				}
			}),
		);
	}

	/** Apply one entity result (from the shared store or a fresh fetch) to the render fields. */
	private applyEntity(result: TEntityResult): void {
		this.vertex = result.vertex;
		this.edges = (result.edges as EdgeData[]) ?? [];
		this.incomingCount = result.incomingCount ?? 0;
		this.products = result as unknown as Record<string, unknown>;
	}

	/** Open an individual by ID — cache-first from the shared entity store, fetching only on a miss (the fetch then
	 *  populates the store, so every view of the same individual shares one copy and one live subscription). */
	async open(id: string, label: string = defaultLabel()): Promise<void> {
		// Surface the subject as an attribute so external code (e.g. the COLUMN_CLOSE
		// listener in app.ts) can detect which entity is in this column without
		// reaching through the protected `state` field.
		this.setAttribute("data-subject", id);
		this.setState({ individualId: id, persistedAs: label, loading: true, error: undefined });
		const accessLevel = appAccessLevel();
		const cached = getCachedEntity(label, id);
		if (cached) {
			this.applyEntity(cached);
			this.setState({ loading: false });
		} else {
			const res = await callStep<TEntityResult>("getIndividualWithEdges", { label, id, accessLevel }, `entity-column: open ${label}:${id}`);
			if (!res.ok) {
				// RPC unavailable (offline / disconnected): serve the persisted vertex from the off-heap store if we have it.
				const offline = await derefStoredEntity(label, id);
				if (offline) this.applyEntity(offline as TEntityResult);
				this.setState({ loading: false, error: offline ? undefined : res.error });
				return;
			}
			setCachedEntity(label, id, res.value);
			this.applyEntity(res.value);
			this.setState({ loading: false });
		}
		this.dispatchEvent(
			new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, {
				detail: { patterns: [{ s: id }], accessLevel, label },
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
		// Renderable body sub-resources (email/file/comment/credential content) make this a full view, never a stub: the
		// body is the substance even when there are few scalar fields, so it must always reach renderContentIframe.
		const contentIframe = this.renderContentIframe(persistedAs);
		const isStub = Object.values(fields).filter((v) => (Array.isArray(v) ? v.length > 0 : v)).length <= 1 && contentIframe.length === 0;
		const typeLine = this.typeDescriptionLine(persistedAs);

		let contentHtml: string;
		if (isStub) {
			const id = idOf(this.vertex);
			const stubDetails = this.typeDisclosure(persistedAs, typeLine);
			contentHtml = `<div class="entity-header" data-testid="entity-stub"><span class="entity-type">${esc(persistedAs)}</span><span class="entity-id">${esc(id)}</span></div>${stubDetails}${this.renderRoles()}${this.renderReferences()}`;
		} else {
			const summaryFields = getSummaryFields(persistedAs);
			// Every non-summary, non-edge field, shown in full between the type disclosure and the body — so a SeqPath's
			// stepText (what it was invoked for) and the like are visible, not buried in a collapsed section. Object values
			// render as formatted JSON.
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
			contentHtml = `${detailsHtml}${summaryHtml}${this.renderRoles()}${fieldsHtml}${this.renderItemsTable()}${this.renderReferences()}${contentIframe}`;
		}

		return html`${unsafeHTML(this.emitHypermediaScript(this.products))}<div class="entity-content">${unsafeHTML(contentHtml)}</div>`;
	}

	protected updated(): void {
		if (!this.state.loading && !this.state.error && this.vertex) this.bindEvents();
	}

	// The type's description, shown inside the disclosure (the type name itself is the disclosure summary). Empty for an ad-hoc result view with no registered type.
	private typeDescriptionLine(persistedAs: string): string {
		const desc = getTypeDescription(persistedAs);
		if (!desc) return "";
		return `<div class="entity-type-description" data-testid="entity-type-description">${esc(desc)}</div>`;
	}

	// The type disclosure: its summary is the type name as a link to the type's own view (description, schema, individuals —
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
		return `<a class="col-link" rel="item" href="#" data-value="${escAttr(id)}" data-label="${escAttr(label)}"${testId}>${esc(truncate(display, 60))}</a>`;
	}

	/** Plain-language names for the role a linked party plays, so the trust structure reads for an end user. Ontology-
	 *  driven: the roles come from roleRels (rels subPropertyOf inRoleOf); this only prettifies the known ones, else the rel. */
	private static readonly ROLE_PHRASE: Record<string, string> = {
		issuer: "Issued by",
		credentialSubject: "About",
		holder: "Held by",
		verifier: "Checked by",
		presentedTo: "Presented to",
		delegatedFrom: "Delegated from",
		delegator: "Delegated by",
		resolvedIssuer: "Issuer resolved to",
		performedBy: "Performed by",
		controller: "Controlled by",
		wasAttributedTo: "Attributed to",
		author: "Written by",
		registeredIn: "Registered in",
	};

	/** The node's roles in plain language — who plays what role toward it (issued by, about, held by, delegated from …),
	 *  so the roles are explained rather than left as raw rels. Reads the role edges (roleRels). A role is one fact per
	 *  (rel, party), so a rel repeated to the same party renders once — as renderReferences dedups its targets. */
	private renderRoles(): string {
		const roles = roleRels();
		const seen = new Set<string>();
		const rows = this.edges
			.filter((e) => roles.has(e.type) && isReferenceEdge(e.type))
			.filter((e) => {
				const key = `${e.type}${idOf(e.target)}`;
				return seen.has(key) ? false : (seen.add(key), true);
			})
			.map((e) => `<div class="role-row"><span class="role-phrase">${esc(ShuEntityColumn.ROLE_PHRASE[e.type] ?? e.type)}</span> ${this.renderEdgeTarget(e.target, e.type)}</div>`)
			.join("");
		if (!rows) return "";
		return `<div class="roles-explanation" data-testid="entity-roles"><span class="section-label">Roles</span>${rows}</div>`;
	}

	private renderReferences(): string {
		// Exclude edges already shown in the summary section
		const summaryFields = getSummaryFields(this.state.persistedAs);
		const roles = roleRels();
		const outgoing = this.edges.filter((e) => !summaryFields.has(e.type) && isReferenceEdge(e.type) && !roles.has(e.type));

		if (outgoing.length === 0 && this.incomingCount === 0) return "";

		// Deduplicate targets for display — inReplyTo takes priority over references
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
	 * on each Body's `mediaType` triple — same path for Comment markdown,
	 * Email plain/html/markdown, Proposal rationale, File markdown, etc.
	 */
	private renderContentIframe(_persistedAs: string): string {
		const vertex = this.vertex;
		if (!vertex) return "";
		const bodies = (vertex.hasBody as Array<{ id?: string; content?: string; mediaType?: string }> | undefined) ?? [];
		const available = bodies.filter((b) => typeof b.content === "string" && b.content.length > 0 && typeof b.mediaType === "string");
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
		const raw = String(active.content ?? "");
		const content = renderContentHtml(raw, String(active.mediaType));
		const encoded = utf8ToBase64(buildBodyIframeDoc(content, String(active.mediaType)));
		const invertible = String(active.mediaType) !== "text/html" ? " invertible" : "";
		const iframeHtml = `<iframe class="body-iframe${invertible}" data-body-id="${escAttr(String(active.id ?? ""))}" sandbox="allow-same-origin" src="data:text/html;base64,${encoded}" data-testid="email-body-iframe"></iframe>`;

		const copyBtn = copyButtonHtml(raw);
		const toolbar = `<div class="content-toolbar">${switcherHtml}${copyBtn}</div>`;
		return `<div class="body-container">${toolbar}${iframeHtml}</div>`;
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
	/** A field's value formatted for the visible field table: an object/array value is pretty-printed as JSON; everything
	 *  else falls through to fieldValueHtml (its navigation affordance + escaping). */
	private formatFieldValue(value: string, propertyName: string): string {
		const trimmed = value.trim();
		if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
			try {
				return `<pre class="field-json" data-testid="field-json-${escAttr(propertyName)}">${esc(JSON.stringify(JSON.parse(trimmed), null, 2))}</pre>`;
			} catch {
				// not valid JSON — render as an ordinary scalar
			}
		}
		return this.fieldValueHtml(value, propertyName);
	}

	private fieldValueHtml(value: string, propertyName: string): string {
		const label = this.state.persistedAs;
		if (getRelSync(label, propertyName) === "item") return this.clickableValue(value, "filter", propertyName);
		if (propertyName === getIdField(label)) {
			const id = idOf(this.vertex ?? {});
			return `<a class="col-link" rel="item" href="#" data-value="${escAttr(id)}" data-label="${escAttr(label)}" data-property="${escAttr(propertyName)}">${esc(truncate(value, 80))}</a>`;
		}
		if (getQueryableFields(label).includes(propertyName)) return this.clickableValue(value, "filter", propertyName);
		return esc(truncate(value, 80));
	}

	/** The type's scoped @context (field → {@id, @type?}) from the served hypermedia — the server resolves each field to
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
	 *  a standard/consumer vocabulary shows its prefix (cred/prov/vcstatus/…). Empty when the context omits the field. */
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

	/** Render the rdf:type field the standard JSON-LD way: named `@type`, its values the entity's classes — each a link
	 *  that opens the class's type column, so a credential's [VerifiableCredential, AquaticAnimalImportPermit] are both
	 *  explorable. */
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
					// Resolve entity ID from edge target data — the graph edge
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
		return `<a class="${linkClass}" rel="${rel}" href="#" data-value="${escAttr(resolvedValue)}"${labelAttr}${propAttr}${testId}>${esc(truncate(value, 80))}</a>`;
	}

	private bindEvents(): void {
		this.shadowRoot?.querySelectorAll(".col-link, .pred-link").forEach((el) => {
			el.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const target = el as HTMLElement;
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
						// A class from the @type row — open its type view through the shared hypermedia ref router (a domain
						// reference), the same navigation a #Type link and a graph class-click use.
						openRef(e, "domain", { domain: value });
						break;
					case "filter":
					default:
						if (propertyName) {
							PaneState.request({ paneType: "filter-eq", persistedAs: this.state.persistedAs, predicate: propertyName, value });
						}
						break;
				}
			});
		});

		// Body switcher buttons — dispatch on the linked Body's mediaType.
		this.shadowRoot?.querySelectorAll(".content-switch-btn").forEach((btn) => {
			btn.addEventListener("click", () => {
				const bodyId = (btn as HTMLElement).dataset.bodyId;
				if (!bodyId || !this.vertex) return;
				this.shadowRoot?.querySelectorAll(".content-switch-btn").forEach((b) => b.classList.remove("active"));
				btn.classList.add("active");
				const bodies = (this.vertex.hasBody as Array<{ id?: string; content?: string; mediaType?: string }> | undefined) ?? [];
				const body = bodies.find((b) => String(b.id ?? "") === bodyId);
				if (!body || typeof body.content !== "string" || typeof body.mediaType !== "string") return;
				const raw = body.content;
				const content = renderContentHtml(raw, body.mediaType);
				const iframe = this.shadowRoot?.querySelector(".body-iframe") as HTMLIFrameElement | null;
				if (iframe) {
					iframe.dataset.bodyId = bodyId;
					iframe.classList.toggle("invertible", body.mediaType !== "text/html");
					iframe.src = `data:text/html;base64,${utf8ToBase64(buildBodyIframeDoc(content, body.mediaType))}`;
				}
			});
		});

		// "What links here" — clickable to open a filter column
		this.shadowRoot?.querySelector(".links-here-link")?.addEventListener("click", (e) => {
			e.preventDefault();
			PaneState.request({ paneType: "filter-incoming", persistedAs: this.state.persistedAs, subject: this.state.individualId });
		});
		this.shadowRoot?.querySelector(".thread-link")?.addEventListener("click", (e) => {
			e.preventDefault();
			PaneState.request({ paneType: "thread", persistedAs: this.state.persistedAs, subject: this.state.individualId });
		});

		bindCopyButtons(this.shadowRoot as ShadowRoot);
	}
}
